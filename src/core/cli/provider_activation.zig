//! Switches the saved profile to a provider and its credential: `lia provider`
//! does it, and so do `lia login`, `lia teams` and ACP `authenticate` once a
//! sign-in is saved.
const std = @import("std");
const builtin = @import("builtin");
const io_mod = @import("../shared/io.zig");
const auth_runtime = @import("../auth/auth_runtime.zig");
const config_runtime = @import("../config/config_runtime.zig");
const credentials = @import("../auth/credentials.zig");
const model_provider = @import("../config/model_provider.zig");
const debug_trace = @import("../shared/debug_trace.zig");
const gateway_provider = @import("../gateway/gateway_provider.zig");
const model_catalog = @import("../gateway/model_catalog.zig");
const provider_set = @import("../gateway/provider_set.zig");
const host = @import("../hosts/host.zig");
const login_flow = @import("../auth/login_flow.zig");
const provider_catalog = @import("../auth/provider_catalog.zig");
const output_contracts = @import("../output/output_contracts.zig");
const token_pass = @import("../gateway/token_pass.zig");
const token_pass_memory = @import("../gateway/token_pass_memory.zig");
const token_pass_check = @import("../app/token_pass_check.zig");

const Allocator = std.mem.Allocator;

pub const Caller = enum {
    provider_command,
    provider_login,
};

pub const WriteFn = *const fn (?*anyopaque, []const u8) anyerror!void;

/// Where activation reports. Only `.provider_command` writes to stdout.
pub const Output = struct {
    stdout_ctx: ?*anyopaque = null,
    stderr_ctx: ?*anyopaque = null,
    write_stdout: WriteFn,
    write_stderr: WriteFn,

    fn stdout(self: Output, text: []const u8) !void {
        try self.write_stdout(self.stdout_ctx, text);
    }

    fn stderr(self: Output, text: []const u8) !void {
        try self.write_stderr(self.stderr_ctx, text);
    }
};

/// The process configuration activation reads.
pub const Env = struct {
    /// Whose workspace settings are read; null for the directory lia runs in.
    workspace_root: ?[]const u8 = null,
    auth_mode: credentials.AuthMode,
    default_model: []const u8,
    models_path: []const u8,
    gateway_provider: gateway_provider.Provider,
    provider_set: provider_set.Set,
    secret_store: host.SecretStore,
    url_opener: host.UrlOpener,
};

fn selectCatalogModel(
    entries: []const model_catalog.ModelCatalogEntry,
    saved: ?[]const u8,
) ?[]const u8 {
    if (saved) |candidate| {
        for (entries) |entry| {
            if (std.mem.eql(u8, entry.id, candidate)) return entry.id;
        }
    }
    return if (entries.len > 0) entries[0].id else null;
}

fn writeProviderActivationError(
    alloc: Allocator,
    output: Output,
    caller: Caller,
    detail: []const u8,
) !void {
    const message = try alloc.print(
        "{s}: {s}\n",
        .{ if (caller == .provider_login) "lia login" else "lia provider", detail },
    );
    defer alloc.free(message);
    try output.stderr(message);
}

/// What `lia login` says about the team's Token Pass after a Gateway sign-in.
pub const TokenPassLoginNotice = struct {
    /// The team has an active Token Pass, so the billing hint is left out.
    active: bool = false,
    /// Owned; null when there is nothing to say.
    line: ?[]u8 = null,

    pub fn deinit(self: *TokenPassLoginNotice, alloc: Allocator) void {
        if (self.line) |line| alloc.free(line);
        self.* = .{};
    }
};

/// Saves `target` as the profile's provider, with its model and, when
/// `exact_source` is set, its credential source. Returns false after
/// reporting why it could not.
pub fn activateProviderSelection(
    alloc: Allocator,
    env: Env,
    output: Output,
    target: model_provider.ProviderId,
    caller: Caller,
    exact_source: ?credentials.Source,
) !bool {
    return activateProviderSelectionWithNotice(alloc, env, output, target, caller, exact_source, null);
}

/// `activateProviderSelection` that also fills `out_token_pass`, when set,
/// for a Gateway credential: the team's Token Pass, from its credits and the
/// catalog's marks.
pub fn activateProviderSelectionWithNotice(
    alloc: Allocator,
    env: Env,
    output: Output,
    target: model_provider.ProviderId,
    caller: Caller,
    exact_source: ?credentials.Source,
    out_token_pass: ?*TokenPassLoginNotice,
) !bool {
    return activateProviderSelectionFallible(alloc, env, output, target, caller, exact_source, out_token_pass) catch |err| {
        switch (err) {
            error.CredentialStorageUnavailable,
            error.CredentialTemporarilyUnavailable,
            error.CredentialRefreshPersistenceUncertain,
            error.CredentialAuthorityChanged,
            => {},
            else => return err,
        }
        const detail = try auth_runtime.preparationFailureText(alloc, target, err);
        defer alloc.free(detail);
        try writeProviderActivationError(alloc, output, caller, detail);
        return false;
    };
}

pub fn runProviderLogin(alloc: Allocator, env: Env, provider: model_provider.ProviderId) !void {
    switch (provider) {
        .gateway => try login_flow.runLogin(alloc, env.gateway_provider.oauth_transport, env.url_opener),
        .configured => return error.ConfiguredProviderUsesEnvironmentAuth,
    }
}

pub fn writeProviderLoginFailure(alloc: Allocator, output: Output, provider: model_provider.ProviderId, caller: Caller, err: anyerror) !void {
    debug_trace.logf("auth", "provider sign-in failed provider={t} err={s}", .{ provider, @errorName(err) });
    const failure = auth_runtime.classifyCredentialFailure(provider_catalog.find(provider).login_source, err);
    if (failure.reason == .invalid_storage or failure.reason == .persistence_uncertain) {
        const detail = try auth_runtime.preparationFailureText(alloc, provider, err);
        defer alloc.free(detail);
        try writeProviderActivationError(alloc, output, caller, detail);
        return;
    }
    try writeProviderActivationError(alloc, output, caller, switch (err) {
        error.ClientIdMissing => "missing LIA_OAUTH_CLIENT_ID; configure the lia Vercel App client id first",
        error.AccessDenied => "authorization denied",
        error.ExpiredToken, error.LoginTimedOut => "authorization expired; run lia login again",
        else => "failed to sign in",
    });
}

fn activateProviderSelectionFallible(
    alloc: Allocator,
    env: Env,
    output: Output,
    target: model_provider.ProviderId,
    caller: Caller,
    exact_source: ?credentials.Source,
    out_token_pass: ?*TokenPassLoginNotice,
) !bool {
    const workspace_root = if (env.workspace_root) |root| try alloc.dupe(u8, root) else try io_mod.realpathAlloc(alloc, ".");
    defer alloc.free(workspace_root);
    var settings = config_runtime.loadMergedSettings(alloc, workspace_root) catch |err| {
        const message = try config_runtime.configuredProviderMessage(alloc, err);
        defer if (message) |text| alloc.free(text);
        try writeProviderActivationError(alloc, output, caller, message orelse "could not load settings");
        debug_trace.logf("config", "provider selection settings load failed err={s}", .{@errorName(err)});
        return false;
    };
    defer settings.deinit(alloc);

    if (target == .configured) {
        const bound = target.bind(settings.providers orelse .{}) catch |err| switch (err) {
            error.UnknownConfiguredProvider => {
                const detail = try config_runtime.unknownProviderMessage(alloc, target.label());
                defer alloc.free(detail);
                try writeProviderActivationError(alloc, output, caller, detail);
                // A name lia doesn't know is a bad argument, so the caller
                // exits as a usage error.
                return error.UnknownConfiguredProvider;
            },
            error.ConfiguredProviderChanged, error.ConfiguredProviderRemoved => return err,
        };
        const selected_model = settings.models.get(bound) orelse return error.ConfiguredModelNotSelected;
        var attempt = config_runtime.attemptUserPreferences(alloc, .{
            .provider = bound,
            .model_preference = .{ .provider = bound, .model = selected_model },
        });
        defer attempt.deinit(alloc);
        switch (attempt) {
            .failure => {
                try writeProviderActivationError(alloc, output, caller, "failed to save provider selection");
                return false;
            },
            .outcome => {},
        }
        const message = try alloc.print("Provider set to {s}.\n", .{bound.label()});
        defer alloc.free(message);
        if (caller == .provider_command) try output.stdout(message);
        return true;
    }
    const preferred_source = exact_source orelse settings.credential_source;
    var prepared_credential = if (env.auth_mode == .host_managed)
        null
    else
        try auth_runtime.prepareCredential(
            alloc,
            env.gateway_provider.oauth_transport,
            env.secret_store,
            target,
            preferred_source,
        );
    defer if (prepared_credential) |*credential| credential.deinit(alloc);

    const already_selected = (settings.provider orelse @as(model_provider.ProviderId, .gateway)).eql(target);
    // A selected provider without a persisted model still needs one chosen
    // below; LIA_MODEL only covers a single run, so it does not count here.
    const has_persisted_model = if (config_runtime.selectProviderModel(env.default_model, &settings, target, null)) |_| true else |_| false;
    if (caller == .provider_command and already_selected and has_persisted_model and
        (env.auth_mode == .host_managed or prepared_credential != null))
    {
        try output.stdout(switch (target) {
            .gateway => "Gateway is already selected.\n",
            .configured => "Configured provider is already selected.\n",
        });
        return true;
    }

    var performed_login: ?model_provider.ProviderId = null;
    if (env.auth_mode == .local and prepared_credential == null and provider_catalog.find(target).subscription and caller == .provider_command) {
        runProviderLogin(alloc, env, target) catch |err| {
            try writeProviderLoginFailure(alloc, output, target, caller, err);
            return false;
        };
        performed_login = target;
        prepared_credential = try auth_runtime.prepareCredential(
            alloc,
            env.gateway_provider.oauth_transport,
            env.secret_store,
            target,
            preferred_source,
        );
    }

    const credential = if (env.auth_mode == .host_managed)
        null
    else if (prepared_credential) |*value|
        value
    else {
        try writeProviderActivationError(
            alloc,
            output,
            caller,
            switch (target) {
                .gateway => "configure a Gateway credential first",
                .configured => "configure the provider auth environment variable first",
            },
        );
        return false;
    };
    const catalog_provider = env.provider_set.select(target).model_catalog orelse {
        try writeProviderActivationError(alloc, output, caller, switch (target) {
            .gateway => "Gateway model catalog is unavailable",
            .configured => "Configured model catalog is unavailable",
        });
        return false;
    };
    var credits_task: TeamCreditsTask = undefined;
    var credits_future: ?std.Io.Future(void) = null;
    if (comptime !builtin.single_threaded) {
        if (out_token_pass != null and target == .gateway and credential != null) {
            if (env.provider_set.select(.gateway).credits) |credits_provider| {
                credits_task = .{
                    .alloc = alloc,
                    .provider = credits_provider,
                    .credential = credential.?.token,
                    .credential_source = credential.?.source,
                    .tenant = credential.?.gatewayTeam(),
                };
                credits_future = io_mod.getIo().concurrent(TeamCreditsTask.run, .{&credits_task}) catch null;
            }
        }
    }
    defer if (credits_future) |*future| {
        credits_task.cancel.store(true, .seq_cst);
        future.await(io_mod.getIo());
        credits_task.snapshot.deinit(alloc);
    };

    const fetch_result = model_catalog.fetchWithPublicFallback(catalog_provider, alloc, .{
        .access = if (env.auth_mode == .host_managed)
            .host_managed
        else
            credentials.catalogAccessAt(
                credential.?.*,
                io_mod.milliTimestamp(),
            ).withExplicitAuthority(),
        .endpoint = env.models_path,
        .view = .picker,
    });
    var loaded = switch (fetch_result) {
        .loaded => |loaded| blk: {
            if (loaded.provenance.access.level != .authenticated or
                loaded.provenance.anonymous_fallback_used)
            {
                var rejected = loaded.catalog;
                model_catalog.freeModelCatalog(alloc, &rejected);
                try writeProviderActivationError(
                    alloc,
                    output,
                    caller,
                    "target credential did not produce an authenticated model catalog",
                );
                return false;
            }
            break :blk loaded;
        },
        .failed => |failure| {
            debug_trace.logf("catalog", "provider selection catalog failed provider={s} category={s}", .{ @tagName(target), @tagName(failure.failure.category) });
            const detail = if (failure.failure.category == .transport)
                try alloc.print(
                    "couldn't connect to {s} to load the target model catalog; check your network connection or firewall",
                    .{model_catalog.serviceName(target)},
                )
            else
                try alloc.print(
                    "could not load the target model catalog ({s})",
                    .{@tagName(failure.failure.category)},
                );
            defer alloc.free(detail);
            try writeProviderActivationError(alloc, output, caller, detail);
            return false;
        },
    };
    defer model_catalog.freeModelCatalog(alloc, &loaded.catalog);
    const saved_model = settings.models.get(target);
    const selected_model = selectCatalogModel(loaded.catalog.items, saved_model) orelse {
        try writeProviderActivationError(alloc, output, caller, "target model catalog is empty");
        return false;
    };
    var attempt = config_runtime.attemptUserPreferences(alloc, .{
        .provider = target,
        .model_preference = .{ .provider = target, .model = selected_model },
        .credential_source = exact_source,
    });
    defer attempt.deinit(alloc);
    switch (attempt) {
        .failure => |failure| {
            debug_trace.logf("config", "provider selection persistence failed err={s}", .{@errorName(failure.err)});
            try writeProviderActivationError(alloc, output, caller, "failed to save provider selection");
            return false;
        },
        .outcome => {},
    }
    if (out_token_pass) |dest| {
        if (target == .gateway and credential != null) {
            var credits_snapshot: ?output_contracts.CreditsSnapshot = null;
            defer if (credits_snapshot) |*snapshot| snapshot.deinit(alloc);
            if (credits_future) |*future| {
                const deadline = io_mod.awakeMilliTimestamp() + auth_runtime.default_team_credits_wait_ms;
                while (!credits_task.done.load(.acquire)) {
                    if (io_mod.awakeMilliTimestamp() >= deadline) {
                        credits_task.cancel.store(true, .seq_cst);
                        break;
                    }
                    // Poll the concurrent credits task until it finishes or hits the wait budget (RULES.md R2.3).
                    io_mod.sleep(team_credits_poll_ms * std.time.ns_per_ms);
                }
                const finished_in_time = credits_task.done.load(.acquire);
                future.await(io_mod.getIo());
                credits_future = null;
                if (finished_in_time) {
                    credits_snapshot = credits_task.snapshot;
                } else {
                    credits_task.snapshot.deinit(alloc);
                }
            }
            const catalog_has_marks = catalogHasTokenPassMarks(loaded.catalog.items);
            const credits_answer = if (credits_snapshot) |snapshot| token_pass_check.answerOf(snapshot) else null;
            const remaining = if (credits_snapshot) |snapshot|
                if (snapshot.token_pass) |credit| credit.remaining else null
            else
                null;
            if (credits_answer orelse (if (catalog_has_marks) token_pass.Answer.has_pass else null)) |answer| {
                saveTokenPassAnswer(alloc, credential.?.*, answer);
            }
            const notice = token_pass.resolveTeamNotice(credits_answer, remaining, catalog_has_marks);
            dest.* = .{
                .active = notice == .active,
                .line = try token_pass.formatTeamNotice(alloc, notice, .plain),
            };
        }
    }
    if (performed_login) |provider| switch (provider) {
        .gateway, .configured => unreachable,
    };
    if (caller == .provider_command) {
        try output.stdout(switch (target) {
            .gateway => "Provider set to Gateway.\n",
            .configured => "Provider set to configured connection.\n",
        });
    }
    return true;
}

const team_credits_poll_ms: u64 = 10;

/// Fetches the team's credits beside the catalog fetch, so the Token Pass
/// notice costs `lia login` no extra wait when both answer in time.
const TeamCreditsTask = struct {
    alloc: Allocator,
    provider: gateway_provider.CreditsProvider,
    credential: ?[]const u8,
    credential_source: credentials.Source,
    tenant: ?[]const u8,
    cancel: std.atomic.Value(bool) = .init(false),
    done: std.atomic.Value(bool) = .init(false),
    snapshot: output_contracts.CreditsSnapshot = .{},

    fn run(self: *TeamCreditsTask) void {
        self.snapshot = self.provider.fetch(self.alloc, .{
            .credential = self.credential,
            .credential_source = self.credential_source,
            .tenant = self.tenant,
            .cancel_flag = &self.cancel,
        });
        self.done.store(true, .release);
    }
};

fn catalogHasTokenPassMarks(entries: []const model_catalog.ModelCatalogEntry) bool {
    for (entries) |entry| {
        if (entry.token_pass) return true;
    }
    return false;
}

fn saveTokenPassAnswer(
    alloc: Allocator,
    credential: credentials.Credential,
    answer: token_pass.Answer,
) void {
    const home = io_mod.homeDir() orelse return;
    const named = token_pass_check.name(
        alloc,
        credential.source,
        credential.token,
        credential.accountId(),
        credential.gatewayTeam(),
    ) orelse return;
    const id = named.saved_as orelse return;
    token_pass_memory.save(alloc, home, &id, answer) catch |err| {
        debug_trace.logf("token_pass", "saved answer not written err={s}", .{@errorName(err)});
    };
}
