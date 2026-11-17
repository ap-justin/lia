//! Client-provided system prompt for ACP sessions, following the ACP
//! client system prompt RFD in append mode. The prompt is validated before a
//! session exists, persisted with the session, restored on load and resume,
//! and delivered in the system slot after lia's own instructions.

const std = @import("std");
const acp_types = @import("types.zig");
const io_mod = @import("../core/shared/io.zig");
const session_child_store = @import("../core/session/session_child_store.zig");

const Allocator = std.mem.Allocator;

pub const max_bytes: usize = 64 * 1024;
/// The most a developer-instructions block may hold to be kept as the
/// session's client prompt; a larger block goes to the model as user text.
/// The session log takes a value of `max_value_bytes` at most
/// (`core/session_manager/api.zig`) and JSON escapes a control byte as six,
/// so a block under this limit can still fail to save and go as user text.
pub const developer_max_bytes: usize = 1024 * 1024;
/// The side file a v1 session keeps the prompt in.
pub const file_name = "system-prompt.txt";
const block_separator = "\n\n";

pub const ParseError = Allocator.Error || error{
    InvalidParams,
    InvalidSystemPrompt,
    EmptySystemPrompt,
    BlankSystemPrompt,
    UnsupportedSystemPromptBlock,
    SystemPromptTooLarge,
    InvalidSystemPromptText,
    DuplicateSystemPrompt,
    SystemPromptModeWithoutPrompt,
    UnsupportedSystemPromptMode,
};

/// Returns the owned prompt from `session/new` params, or null when absent.
/// `systemPrompt` is the RFD field. `_meta.lia.systemPrompt` carries the same
/// content for clients whose SDK drops unknown request fields.
pub fn parse(alloc: Allocator, params_raw: ?[]const u8) ParseError!?[]u8 {
    const raw = params_raw orelse return null;
    const parsed = std.json.parseFromSlice(std.json.Value, alloc, raw, .{}) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidParams,
    };
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidParams;
    const params = parsed.value.object;

    const standard = params.get("systemPrompt");
    const extension = acp_types.liaMetaField(params, "systemPrompt");
    if (standard != null and extension != null) return error.DuplicateSystemPrompt;
    const blocks = standard orelse extension;

    if (params.get("systemPromptMode")) |mode| {
        if (blocks == null) return error.SystemPromptModeWithoutPrompt;
        if (mode != .string or !std.mem.eql(u8, mode.string, "append")) {
            return error.UnsupportedSystemPromptMode;
        }
    }
    return try joinTextBlocks(alloc, blocks orelse return null);
}

pub fn parseErrorMessage(err: ParseError) []const u8 {
    return switch (err) {
        error.OutOfMemory => "Out of memory",
        error.InvalidParams => "Invalid params",
        error.InvalidSystemPrompt => "systemPrompt must be an array of content blocks",
        error.EmptySystemPrompt => "systemPrompt must contain at least one content block",
        error.BlankSystemPrompt => "systemPrompt text cannot be empty",
        error.UnsupportedSystemPromptBlock => "systemPrompt supports text content blocks only",
        error.SystemPromptTooLarge => "systemPrompt exceeds the 64 KiB limit",
        error.InvalidSystemPromptText => "systemPrompt text must be valid UTF-8 without NUL bytes",
        error.DuplicateSystemPrompt => "Send systemPrompt or _meta.lia.systemPrompt, not both",
        error.SystemPromptModeWithoutPrompt => "systemPromptMode requires systemPrompt",
        error.UnsupportedSystemPromptMode => "systemPromptMode supports only \"append\"",
    };
}

fn joinTextBlocks(alloc: Allocator, blocks: std.json.Value) ParseError![]u8 {
    if (blocks != .array) return error.InvalidSystemPrompt;
    if (blocks.array.items.len == 0) return error.EmptySystemPrompt;
    var text: std.ArrayList(u8) = .empty;
    errdefer text.deinit(alloc);
    for (blocks.array.items, 0..) |block, index| {
        if (block != .object) return error.UnsupportedSystemPromptBlock;
        const kind = block.object.get("type") orelse return error.UnsupportedSystemPromptBlock;
        const value = block.object.get("text") orelse return error.UnsupportedSystemPromptBlock;
        if (kind != .string or !std.mem.eql(u8, kind.string, "text") or value != .string) {
            return error.UnsupportedSystemPromptBlock;
        }
        // `text` never exceeds `max_bytes`, so the subtraction cannot wrap.
        const separator_len: usize = if (index == 0) 0 else block_separator.len;
        const added = value.string.len + separator_len;
        if (added > max_bytes - text.items.len) return error.SystemPromptTooLarge;
        if (index > 0) try text.appendSlice(alloc, block_separator);
        try text.appendSlice(alloc, value.string);
    }
    if (std.mem.trim(u8, text.items, " \t\r\n").len == 0) return error.BlankSystemPrompt;
    if (!validText(text.items)) return error.InvalidSystemPromptText;
    return text.toOwnedSlice(alloc);
}

fn validText(text: []const u8) bool {
    return std.unicode.utf8ValidateSlice(text) and std.mem.findScalar(u8, text, 0) == null;
}

/// Stores the prompt with its session so load and resume restore it.
pub fn persist(
    alloc: Allocator,
    capability: *session_child_store.SessionChildCapability,
    text: []const u8,
) !void {
    var entry = try capability.atomicReplace(alloc, .client_context, file_name, text);
    entry.deinit(alloc);
}

/// Returns the owned persisted prompt, or null when the session has none.
pub fn load(
    alloc: Allocator,
    capability: *session_child_store.SessionChildCapability,
) !?[]u8 {
    var file = capability.openFileReadOnly(alloc, .client_context, file_name) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer file.deinit();
    // The reader rejects a file that reaches its limit, so allow one byte
    // more to accept a prompt of exactly `max_bytes`.
    const text = try file.readToEnd(alloc, max_bytes + 1);
    errdefer alloc.free(text);
    if (text.len == 0 or !validText(text)) return error.InvalidSystemPromptText;
    return text;
}

/// The block OpenBot puts at the front of a prompt with the developer
/// instructions it wants the model to follow.
pub const developer_open = "<openbot-developer-instructions>";
pub const developer_close = "</openbot-developer-instructions>";

pub const DeveloperSplit = struct {
    /// The whole block, tags included.
    block: []const u8,
    /// The prompt after the block, without the blank lines that follow it.
    rest: []const u8,
};

/// Splits a leading developer-instructions block off a prompt, or returns
/// null when the prompt does not start with a complete one. Both parts point
/// into `text`.
pub fn splitDeveloperInstructions(text: []const u8) ?DeveloperSplit {
    const start = std.mem.trimStart(u8, text, " \t\r\n");
    if (!std.mem.startsWith(u8, start, developer_open)) return null;
    const close_at = std.mem.find(u8, start, developer_close) orelse return null;
    const end = close_at + developer_close.len;
    return .{
        .block = start[0..end],
        .rest = std.mem.trimStart(u8, start[end..], " \t\r\n"),
    };
}

/// Whether a session's client prompt is OpenBot's developer-instructions
/// block, which already holds the workspace `AGENTS.md`.
pub fn isDeveloperInstructions(client_prompt: []const u8) bool {
    return std.mem.startsWith(u8, client_prompt, developer_open);
}

/// Whether a developer-instructions block can be kept as a session's client
/// prompt.
pub fn storable(text: []const u8) bool {
    return text.len <= developer_max_bytes and validText(text);
}

/// Joins host instructions with the client prompt for the system slot, after
/// lia's built-in instructions. Caller owns the result.
pub fn compose(alloc: Allocator, host_instructions: []const u8, client_prompt: []const u8) ![]u8 {
    if (client_prompt.len == 0) return alloc.dupe(u8, host_instructions);
    const separator = if (host_instructions.len > 0) "\n\n" else "";
    return std.mem.concat(alloc, u8, &.{
        host_instructions,
        separator,
        "<client_instructions>\n",
        client_prompt,
        "\n</client_instructions>",
    });
}

test "client system prompt parses RFD text blocks in append mode" {
    const alloc = std.testing.allocator;
    const text = (try parse(alloc,
        \\{"cwd":"/tmp","systemPrompt":[{"type":"text","text":"You run inside Mini."},{"type":"text","text":"Use browser tools."}],"systemPromptMode":"append"}
    )).?;
    defer alloc.free(text);
    try std.testing.expectEqualStrings("You run inside Mini.\n\nUse browser tools.", text);

    const meta = (try parse(alloc,
        \\{"_meta":{"lia":{"systemPrompt":[{"type":"text","text":"From meta."}]}}}
    )).?;
    defer alloc.free(meta);
    try std.testing.expectEqualStrings("From meta.", meta);

    try std.testing.expect((try parse(alloc, "{\"cwd\":\"/tmp\"}")) == null);
}

test "client system prompt rejects invalid combinations before a session exists" {
    const alloc = std.testing.allocator;
    const cases = [_]struct { json: []const u8, expected: ParseError }{
        .{ .json = "{\"systemPrompt\":[]}", .expected = error.EmptySystemPrompt },
        .{ .json = "{\"systemPrompt\":[{\"type\":\"text\",\"text\":\" \"}]}", .expected = error.BlankSystemPrompt },
        .{ .json = "{\"systemPrompt\":\"text\"}", .expected = error.InvalidSystemPrompt },
        .{ .json = "{\"systemPrompt\":[{\"type\":\"image\",\"data\":\"x\"}]}", .expected = error.UnsupportedSystemPromptBlock },
        .{ .json = "{\"systemPromptMode\":\"append\"}", .expected = error.SystemPromptModeWithoutPrompt },
        .{ .json = "{\"systemPrompt\":[{\"type\":\"text\",\"text\":\"x\"}],\"systemPromptMode\":\"override\"}", .expected = error.UnsupportedSystemPromptMode },
        .{ .json = "{\"systemPrompt\":[{\"type\":\"text\",\"text\":\"a\"}],\"_meta\":{\"lia\":{\"systemPrompt\":[{\"type\":\"text\",\"text\":\"b\"}]}}}", .expected = error.DuplicateSystemPrompt },
        .{ .json = "{\"systemPrompt\":[{\"type\":\"text\",\"text\":\"a\\u0000b\"}]}", .expected = error.InvalidSystemPromptText },
    };
    for (cases) |case| {
        try std.testing.expectError(case.expected, parse(alloc, case.json));
    }

    const oversized = try alloc.alloc(u8, max_bytes + 1);
    defer alloc.free(oversized);
    @memset(oversized, 'x');
    const json = try alloc.print("{{\"systemPrompt\":[{{\"type\":\"text\",\"text\":\"{s}\"}}]}}", .{oversized});
    defer alloc.free(json);
    try std.testing.expectError(error.SystemPromptTooLarge, parse(alloc, json));
}

test "client system prompt composes after host instructions" {
    const alloc = std.testing.allocator;
    const only_host = try compose(alloc, "host", "");
    defer alloc.free(only_host);
    try std.testing.expectEqualStrings("host", only_host);

    const both = try compose(alloc, "host", "client");
    defer alloc.free(both);
    try std.testing.expectEqualStrings("host\n\n<client_instructions>\nclient\n</client_instructions>", both);

    const only_client = try compose(alloc, "", "client");
    defer alloc.free(only_client);
    try std.testing.expectEqualStrings("<client_instructions>\nclient\n</client_instructions>", only_client);
}

test "client system prompt of exactly the size limit survives a restore" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    // Session directories must be private for the child store to open them.
    try tmp.dir.createDir(std.testing.io, "session", std.Io.File.Permissions.fromMode(0o700));
    var session_dir = try tmp.dir.openDir(std.testing.io, "session", .{ .iterate = true, .follow_symlinks = false });
    defer session_dir.close(std.testing.io);
    const session_path = try io_mod.dirRealpathAlloc(alloc, tmp.dir, "session");
    defer alloc.free(session_path);
    var capability = try session_child_store.SessionChildCapability.initForTesting(alloc, session_dir, session_path, .writable, .{});
    defer capability.deinit();

    const text = try alloc.alloc(u8, max_bytes);
    defer alloc.free(text);
    @memset(text, 'a');
    try persist(alloc, &capability, text);
    const restored = (try load(alloc, &capability)).?;
    defer alloc.free(restored);
    try std.testing.expectEqual(max_bytes, restored.len);
}

test "a leading developer-instructions block splits off the prompt" {
    const split = splitDeveloperInstructions("\n<openbot-developer-instructions>\nBe brief.\n</openbot-developer-instructions>\n\n<openbot_context>x</openbot_context>\nHi").?;
    try std.testing.expectEqualStrings("<openbot-developer-instructions>\nBe brief.\n</openbot-developer-instructions>", split.block);
    try std.testing.expectEqualStrings("<openbot_context>x</openbot_context>\nHi", split.rest);
    try std.testing.expect(isDeveloperInstructions(split.block));

    try std.testing.expect(splitDeveloperInstructions("Hi <openbot-developer-instructions>x</openbot-developer-instructions>") == null);
    try std.testing.expect(splitDeveloperInstructions("<openbot-developer-instructions>never closed") == null);
    try std.testing.expect(splitDeveloperInstructions("<openbot_context>x</openbot_context>") == null);
    const only = splitDeveloperInstructions("<openbot-developer-instructions></openbot-developer-instructions>").?;
    try std.testing.expectEqualStrings("", only.rest);
}

test "a developer block is storable up to its own limit and only as valid text" {
    const alloc = std.testing.allocator;
    const big = try alloc.alloc(u8, developer_max_bytes);
    defer alloc.free(big);
    @memset(big, 'a');
    try std.testing.expect(storable(big));
    const over = try std.mem.concat(alloc, u8, &.{ big, "a" });
    defer alloc.free(over);
    try std.testing.expect(!storable(over));
    try std.testing.expect(!storable("a\x00b"));
    try std.testing.expect(!storable("\xff"));
}
