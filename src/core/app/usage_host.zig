//! lia's side of the usage module: HTTP through the gateway client, the
//! clock, and which sign-in `/usage` reads with.

const std = @import("std");
const usage = @import("../../usage/usage.zig");
const client = @import("../../gateway/client.zig");
const auth_runtime = @import("../auth/auth_runtime.zig");
const credentials = @import("../auth/credentials.zig");
const oauth_session = @import("../auth/oauth_session.zig");
const debug_trace = @import("../shared/debug_trace.zig");
const io_mod = @import("../shared/io.zig");
const profile_paths = @import("../shared/profile_paths.zig");
const stored_login_testing = @import("../auth/stored_login_testing.zig");
const types = @import("../shared/types.zig");

const Allocator = std.mem.Allocator;

const vercel_api_origin = "https://api.vercel.com";
/// Test-only: a file holding the current time in milliseconds, so the E2E
/// driver can move `/usage`'s clock. Unset in normal use.
const clock_file_env = "LIA_TEST_USAGE_CLOCK_FILE";

/// A host with no home directory, for a dashboard that `host` replaces once
/// the home is known.
pub const unset: usage.Host = .{ .fetch_fn = fetch, .now_fn = now, .io_fn = io, .home = "", .renew_fn = renewFromStore };

/// `home` is the user's home directory; the cache follows `$LIA_HOME`.
pub fn host(home: []const u8) usage.Host {
    return .{
        .fetch_fn = fetch,
        .now_fn = now,
        .io_fn = io,
        .home = profile_paths.rootParent(home),
        .lia_dir_name = profile_paths.rootName(),
        .renew_fn = renewFromStore,
    };
}

fn io(_: ?*anyopaque) std.Io {
    return io_mod.getIo();
}

/// A newer token for a sign-in the provider refused, which another lia process
/// saved since this one read it: the stored lia login for the same team. Never refreshes the
/// sign-in; an API key has nothing to renew.
fn renewFromStore(_: ?*anyopaque, alloc: Allocator, renewal: usage.Renewal) ?[]u8 {
    const sign_in: auth_runtime.SharedSignIn = switch (renewal.scope) {
        .member => .{ .source = .fx_login, .team = renewal.team },
        .api_key => return null,
    };
    var stored = (auth_runtime.storedReplacement(alloc, sign_in, renewal.rejected) catch return null) orelse {
        debug_trace.logf("usage", "refused sign-in has no newer stored token scope={t}", .{renewal.scope});
        return null;
    };
    defer stored.deinit(alloc);
    debug_trace.logf("usage", "refused sign-in renewed from the store scope={t}", .{renewal.scope});
    return alloc.dupe(u8, stored.token) catch null;
}

/// Room for a credential's display label.
pub const LabelBuffer = [160]u8;

/// The sign-in `/usage` reads with, or null when lia is not signed in to AI
/// Gateway. Borrows from `auth` and `label_buf`.
pub fn credential(auth: *const auth_runtime.Runtime, label_buf: *LabelBuffer) ?usage.Credential {
    const current = auth.gatewayCredential() orelse {
        const selected = auth.selected_credential;
        debug_trace.logf("usage", "no gateway credential: source={s} selected={} needs_refresh={}", .{
            if (auth.credentialSource()) |source| @tagName(source) else "none",
            selected != null,
            if (selected) |c| c.needsRefreshAt(io_mod.milliTimestamp()) else false,
        });
        return null;
    };
    const mapped = fromParts(current.source, current.api_key, current.gateway_team, current.team_slug, current.account, label_buf);
    if (mapped == null) debug_trace.logf("usage", "gateway credential not usable: source={s}", .{@tagName(current.source)});
    return mapped;
}

/// Why `credential` found nothing: a provider token that needs renewing,
/// another provider, or no sign-in at all.
pub fn missingReason(auth: *const auth_runtime.Runtime) usage.Unavailable {
    const source = auth.credentialSource() orelse return .no_gateway_sign_in;
    return switch (source) {
        .fx_login, .stored_key, .ai_gateway_api_key => .no_gateway_sign_in,
        else => .unsupported_provider,
    };
}

/// The same mapping for a credential loaded without the auth runtime, as
/// `lia usage` does. Borrows from `c` and `label_buf`.
pub fn fromCredential(c: credentials.Credential, label_buf: *LabelBuffer) ?usage.Credential {
    return fromParts(c.source, c.token, c.gatewayTeam(), c.team_slug, c.account_id, label_buf);
}

fn fromParts(
    source: credentials.Source,
    token: ?[]const u8,
    team: ?[]const u8,
    team_slug: ?[]const u8,
    account: ?[]const u8,
    label_buf: *LabelBuffer,
) ?usage.Credential {
    const bearer = token orelse return null;
    return switch (source) {
        .fx_login => .{
            .scope = .member,
            .bearer = bearer,
            .team = team,
            .subject = account orelse team orelse "",
            .label = std.mem.print(label_buf, "{s} (lia login)", .{types.displayGatewayTeam(team_slug, team) orelse "no team"}) catch "lia login",
        },
        .stored_key, .ai_gateway_api_key => .{
            .scope = .api_key,
            .bearer = bearer,
            .team = null,
            .subject = bearer,
            .label = if (source == .ai_gateway_api_key) "API key (AI_GATEWAY_API_KEY)" else "API key (stored)",
        },
        else => null,
    };
}

fn vercelApiOrigin() []const u8 {
    const issuer = oauth_session.configuredIssuerUrl() catch return vercel_api_origin;
    return if (oauth_session.isLoopbackE2EIssuer(issuer)) issuer else vercel_api_origin;
}

fn fetch(
    _: ?*anyopaque,
    alloc: Allocator,
    request: usage.Request,
    cancel: *std.atomic.Value(bool),
) usage.FetchError!usage.Response {
    return send(alloc, request, cancel);
}

/// One usage GET through lia's HTTP client.
fn send(
    alloc: Allocator,
    request: usage.Request,
    cancel: *std.atomic.Value(bool),
) usage.FetchError!usage.Response {
    const origin = switch (request.service) {
        .gateway => client.gatewayBaseUrl(),
        .vercel_api => vercelApiOrigin(),
    };
    const account: client.UsageAccount = .none;
    const url = try alloc.print("{s}{s}", .{ origin, request.path });
    defer alloc.free(url);
    const result = client.fetchUsageGet(alloc, request.bearer, request.team, account, url, cancel) catch |err| switch (err) {
        error.Cancelled => return error.Cancelled,
        error.OutOfMemory => return error.OutOfMemory,
        else => {
            debug_trace.logf("usage", "usage fetch failed service={s} reason={s}", .{
                @tagName(request.service),
                @errorName(err),
            });
            return error.Unavailable;
        },
    };
    debug_trace.logf("usage", "usage fetch service={s} status={d}", .{
        @tagName(request.service),
        @backingInt(result.status),
    });
    return .{ .status = @backingInt(result.status), .body = result.body };
}

fn now(_: ?*anyopaque) i64 {
    if (io_mod.getenv(clock_file_env)) |path| {
        if (readClockFile(path)) |ms| return ms;
    }
    return io_mod.milliTimestamp();
}

fn readClockFile(path: []const u8) ?i64 {
    var buf: [32]u8 = undefined;
    const file_io = io_mod.getIo();
    var file = std.Io.Dir.openFileAbsolute(file_io, path, .{}) catch return null;
    defer file.close(file_io);
    const len = file.readPositionalAll(file_io, &buf, 0) catch return null;
    return std.fmt.parseInt(i64, std.mem.trim(u8, buf[0..len], " \t\r\n"), 10) catch null;
}

test "a refused /usage sign-in renews only to a newer stored token for the same sign-in" {
    const alloc = std.testing.allocator;
    var home: stored_login_testing.StoredLoginHome = undefined;
    try home.install(alloc);
    defer home.deinit();
    // Another lia process renewed the login after this one read it.
    try home.store("rotated-token", "team-id", stored_login_testing.far_future_ms);

    const renewed = renewFromStore(null, alloc, .{ .scope = .member, .rejected = "launch-token", .team = "team-id", .account_id = null }).?;
    defer alloc.free(renewed);
    try std.testing.expectEqualStrings("rotated-token", renewed);
    // The store still holds the refused token: nothing newer to send.
    try std.testing.expect(renewFromStore(null, alloc, .{ .scope = .member, .rejected = "rotated-token", .team = "team-id", .account_id = null }) == null);
    // Another team's login is never sent.
    try std.testing.expect(renewFromStore(null, alloc, .{ .scope = .member, .rejected = "launch-token", .team = "team-other", .account_id = null }) == null);
    // An API key has nothing to renew.
    try std.testing.expect(renewFromStore(null, alloc, .{ .scope = .api_key, .rejected = "vck_key", .team = null, .account_id = null }) == null);
}

test "the usage label names a login's team only by a valid team name" {
    var bad_buf: LabelBuffer = undefined;
    const bad = fromParts(.fx_login, "token", "team_123", "\x1b]2;title\x07", null, &bad_buf).?;
    try std.testing.expectEqualStrings("team_123 (lia login)", bad.label);
    var good_buf: LabelBuffer = undefined;
    const good = fromParts(.fx_login, "token", "team_123", "vercel-labs", null, &good_buf).?;
    try std.testing.expectEqualStrings("vercel-labs (lia login)", good.label);
    var neither_buf: LabelBuffer = undefined;
    const neither = fromParts(.fx_login, "token", "team 123", "\xe2\x80\xaeslug", null, &neither_buf).?;
    try std.testing.expectEqualStrings("no team (lia login)", neither.label);
}
