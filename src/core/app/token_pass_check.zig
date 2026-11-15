//! Finds out whether the team of the AI Gateway credential has Token Pass.
//! When a session starts, lia takes the answer it saved for the team, then
//! asks the credits endpoint in the background, as `/credits` does, and
//! saves the new answer. A team with Token Pass starts a new session on the
//! Token Pass default model when nothing else chose the model. Without a
//! saved answer, the first prompt of a session waits up to
//! `first_prompt_wait_ms` for the check.
const std = @import("std");
const builtin = @import("builtin");
const credentials = @import("../auth/credentials.zig");
const jwt_claims = @import("../auth/jwt_claims.zig");
const debug_trace = @import("../shared/debug_trace.zig");
const io_mod = @import("../shared/io.zig");
const gateway_provider = @import("../gateway/gateway_provider.zig");
const output_contracts = @import("../output/output_contracts.zig");
const token_pass = @import("../gateway/token_pass.zig");
const token_pass_memory = @import("../gateway/token_pass_memory.zig");
const token_pass_team = @import("../gateway/token_pass_team.zig");
const credits_lookup = @import("credits_lookup.zig");

const Allocator = std.mem.Allocator;

/// How long the first prompt of a session waits for a check whose answer lia
/// has not saved before.
pub const first_prompt_wait_ms: i64 = 2_000;

const Identity = [token_pass.identity_len]u8;

/// How the check names a credential's team: `asked` for this run, and
/// `saved_as` for the saved answer, when lia keeps one for the credential.
pub const Named = struct {
    asked: Identity,
    saved_as: ?Identity,
};

/// The name of the credential's team, or null when lia does not check it:
/// a credential that is not for AI Gateway, or one a host manages.
pub fn name(alloc: Allocator, source: credentials.Source, api_key: ?[]const u8, account: ?[]const u8, team: ?[]const u8) ?Named {
    var named: Named = .{ .asked = undefined, .saved_as = null };
    switch (source) {
        .fx_login => if (account) |id| {
            _ = token_pass.identity(&named.asked, .login, id, team);
            named.saved_as = named.asked;
        } else {
            _ = token_pass.identity(&named.asked, .session_token, "", team);
        },
        .ai_gateway_api_key, .stored_key => {
            const key = api_key orelse return null;
            _ = token_pass.identity(&named.asked, .api_key, key, team);
            named.saved_as = named.asked;
        },
        .vercel_oidc_token => {
            const subject = if (api_key) |token| oidcSubject(alloc, token) else null;
            defer if (subject) |value| alloc.free(value);
            if (subject) |value| {
                _ = token_pass.identity(&named.asked, .oidc, value, team);
                named.saved_as = named.asked;
            } else {
                _ = token_pass.identity(&named.asked, .session_token, "", team);
            }
        },
        .host_managed, .configured => return null,
    }
    return named;
}

/// The longest OIDC token whose claims lia reads to name its team.
const max_oidc_token_bytes: usize = 16 * 1024;

/// The team and project a Vercel OIDC token names in its `owner_id` and
/// `project_id` claims, joined by a zero byte, or null when the token is not
/// a JWT with both. The claims stay the same as the token renews. lia uses
/// them only to name the saved answer, so it does not check the signature.
/// Caller owns the result.
fn oidcSubject(alloc: Allocator, token: []const u8) ?[]u8 {
    if (token.len > max_oidc_token_bytes) return null;
    var parsed = jwt_claims.parse(alloc, token) catch return null;
    defer parsed.deinit();
    const owner = claimString(parsed.value.object, "owner_id") orelse return null;
    const project = claimString(parsed.value.object, "project_id") orelse return null;
    return alloc.print("{s}\x00{s}", .{ owner, project }) catch null;
}

fn claimString(claims: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = claims.get(key) orelse return null;
    if (value != .string or value.string.len == 0) return null;
    return value.string;
}

/// What a credits reply says about the team's Token Pass, or null when it
/// says nothing or the request failed.
pub fn answerOf(snapshot: output_contracts.CreditsSnapshot) ?token_pass.Answer {
    if (snapshot.err_message != null) return null;
    if (snapshot.token_pass != null) return .has_pass;
    if (snapshot.no_token_pass) return .no_pass;
    return null;
}

/// How often a wait looks for the check's answer.
const answer_poll_ms: u64 = 10;

/// For `lia ask` and ACP: the answer saved for the team, refreshed by a
/// credits check that runs while the session works. Without a saved answer,
/// `begin` waits for the check, as the first prompt in the app does.
pub const Check = struct {
    lookup: credits_lookup.Lookup = .{},
    named: Named,
    home: ?[]const u8,
    has_pass: bool = false,
    /// Whether the credits check answered in this run.
    answered: bool = false,

    /// Starts the check with the saved answer, or waits at most `wait_ms`
    /// for one when lia has none. Publishes whether the team has Token Pass
    /// to `token_pass_team`.
    pub fn begin(
        self: *Check,
        alloc: Allocator,
        provider: gateway_provider.CreditsProvider,
        input: gateway_provider.CreditsLookupInput,
        wait_ms: i64,
    ) void {
        const saved: ?token_pass.Answer = if (self.home) |dir| if (self.named.saved_as) |id| token_pass_memory.load(alloc, dir, &id) else null else null;
        self.has_pass = saved == .has_pass;
        token_pass_team.publishAnswer(saved, false);
        if (comptime builtin.single_threaded) return;
        // A login that is due for renewal has no token yet; the saved answer
        // stands, and the next run asks.
        if (input.credential == null) {
            debug_trace.logf("token_pass", "check skipped reason=no_token saved={s}", .{answerLabel(saved)});
            return;
        }
        _ = self.lookup.start(provider, input, null, 0) catch |err| {
            debug_trace.logf("token_pass", "check start failed err={s}", .{@errorName(err)});
            return;
        };
        debug_trace.logf("token_pass", "check started saved={s}", .{answerLabel(saved)});
        if (saved == null) self.waitForAnswer(alloc, wait_ms);
    }

    /// Takes the answer if it has arrived, without waiting.
    pub fn poll(self: *Check, alloc: Allocator) void {
        self.waitForAnswer(alloc, 0);
    }

    /// Takes the catalog's Token Pass marks as the team's answer while AI
    /// Gateway has given none in this run (`token_pass_team.catalogAnswers`),
    /// and saves it. Returns true when it changed what lia knows.
    pub fn observeCatalog(self: *Check, alloc: Allocator) bool {
        if (self.has_pass or !token_pass_team.catalogAnswers()) return false;
        self.has_pass = true;
        token_pass_team.publishAnswer(.has_pass, false);
        if (self.home) |dir| if (self.named.saved_as) |id| saveAnswer(alloc, dir, &id, .has_pass);
        debug_trace.logf("token_pass", "check answered answer=has_pass source={s}", .{token_pass_team.catalog_source});
        return true;
    }

    /// Takes an answer that has arrived, then stops the check. `reason`
    /// names why, for the trace, when the check had not answered.
    pub fn finish(self: *Check, alloc: Allocator, reason: []const u8) void {
        self.waitForAnswer(alloc, 0);
        _ = self.observeCatalog(alloc);
        if (self.lookup.task != null) debug_trace.logf("token_pass", "check dropped reason={s}", .{reason});
        self.lookup.deinit();
    }

    fn waitForAnswer(self: *Check, alloc: Allocator, wait_ms: i64) void {
        const deadline = io_mod.awakeMilliTimestamp() + wait_ms;
        while (self.lookup.task != null) {
            if (self.lookup.take()) |taken| {
                var result = taken;
                defer result.deinit();
                const answer = answerOf(result.snapshot);
                if (answer) |fresh| {
                    self.has_pass = fresh == .has_pass;
                    self.answered = true;
                    token_pass_team.publishAnswer(fresh, true);
                    if (self.home) |dir| if (self.named.saved_as) |id| saveAnswer(alloc, dir, &id, fresh);
                }
                // Logged once the answer is saved, so a reader of the trace
                // finds the file current.
                debug_trace.logf("token_pass", "check answered answer={s}", .{answerLabel(answer)});
                return;
            }
            if (io_mod.awakeMilliTimestamp() >= deadline) {
                if (wait_ms > 0) debug_trace.logf("token_pass", "check wait ended without an answer wait_ms={d}", .{wait_ms});
                return;
            }
            io_mod.sleep(answer_poll_ms * std.time.ns_per_ms);
        }
    }
};

fn saveAnswer(alloc: Allocator, home: []const u8, id: []const u8, answer: token_pass.Answer) void {
    token_pass_memory.save(alloc, home, id, answer) catch |err| {
        debug_trace.logf("token_pass", "saved answer not written err={s}", .{@errorName(err)});
    };
}

fn answerLabel(answer: ?token_pass.Answer) []const u8 {
    return if (answer) |value| @tagName(value) else "none";
}

test "token pass check: a credential is named without its secret, and saved only when it lasts" {
    const alloc = std.testing.allocator;
    const login = name(alloc, .fx_login, "token-that-renews", "account_example", "example-team").?;
    try std.testing.expect(login.saved_as != null);
    const renewed = name(alloc, .fx_login, "renewed-token", "account_example", "example-team").?;
    try std.testing.expectEqualSlices(u8, &login.asked, &renewed.asked);

    const key = name(alloc, .ai_gateway_api_key, "vck_example", null, null).?;
    try std.testing.expect(key.saved_as != null);
    try std.testing.expectEqualSlices(u8, &key.asked, &name(alloc, .stored_key, "vck_example", null, null).?.asked);
    try std.testing.expect(!std.mem.eql(u8, &key.asked, &name(alloc, .ai_gateway_api_key, "vck_other", null, null).?.asked));

    // An OIDC token without the team and project claims is asked about for
    // this run only.
    const opaque_token = name(alloc, .vercel_oidc_token, "oidc-token", null, "example-team").?;
    try std.testing.expect(opaque_token.saved_as == null);
    try std.testing.expect(name(alloc, .ai_gateway_api_key, null, null, null) == null);
    try std.testing.expect(name(alloc, .host_managed, "host-token", null, null) == null);
}

fn testOidcToken(buf: []u8, claims: []const u8) []const u8 {
    const header = "eyJhbGciOiJSUzI1NiJ9";
    const encoder = std.base64.url_safe_no_pad.Encoder;
    const payload_len = encoder.calcSize(claims.len);
    @memcpy(buf[0..header.len], header);
    buf[header.len] = '.';
    _ = encoder.encode(buf[header.len + 1 ..][0..payload_len], claims);
    const signature = ".c2lnbmF0dXJl";
    @memcpy(buf[header.len + 1 + payload_len ..][0..signature.len], signature);
    return buf[0 .. header.len + 1 + payload_len + signature.len];
}

test "token pass check: an OIDC token is saved under the team and project it names" {
    const alloc = std.testing.allocator;
    var first_buf: [512]u8 = undefined;
    var renewed_buf: [512]u8 = undefined;
    var other_buf: [512]u8 = undefined;
    var partial_buf: [512]u8 = undefined;
    const first = testOidcToken(&first_buf, "{\"owner_id\":\"team_example\",\"project_id\":\"prj_example\",\"exp\":1}");
    const renewed = testOidcToken(&renewed_buf, "{\"owner_id\":\"team_example\",\"project_id\":\"prj_example\",\"exp\":2}");
    const other = testOidcToken(&other_buf, "{\"owner_id\":\"team_other\",\"project_id\":\"prj_example\",\"exp\":1}");
    const partial = testOidcToken(&partial_buf, "{\"owner_id\":\"team_example\",\"exp\":1}");

    const named = name(alloc, .vercel_oidc_token, first, null, null).?;
    try std.testing.expect(named.saved_as != null);
    // A renewed token keeps its team's saved answer; another team has its own.
    try std.testing.expectEqualSlices(u8, &named.saved_as.?, &name(alloc, .vercel_oidc_token, renewed, null, null).?.saved_as.?);
    try std.testing.expect(!std.mem.eql(u8, &named.saved_as.?, &name(alloc, .vercel_oidc_token, other, null, null).?.saved_as.?));
    try std.testing.expect(name(alloc, .vercel_oidc_token, partial, null, null).?.saved_as == null);
    try std.testing.expect(name(alloc, .vercel_oidc_token, "header.%%%.sig", null, null).?.saved_as == null);
}

test "token pass check: a credits reply answers only when it names Token Pass" {
    try std.testing.expectEqual(token_pass.Answer.has_pass, answerOf(.{ .token_pass = .{ .remaining = "12.00" } }).?);
    // A balance the Gateway could not read still means an active Token Pass.
    try std.testing.expectEqual(token_pass.Answer.has_pass, answerOf(.{ .token_pass = .{} }).?);
    try std.testing.expectEqual(token_pass.Answer.no_pass, answerOf(.{ .no_token_pass = true }).?);
    try std.testing.expect(answerOf(.{ .balance = "4.00" }) == null);
    try std.testing.expect(answerOf(.{ .err_message = "failed", .token_pass = .{ .remaining = "1" } }) == null);
}
