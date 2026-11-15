const std = @import("std");

/// Formats an elapsed duration as `1h2m3s`, dropping leading units that are
/// zero so short durations stay `5s` while long ones read `18m0s` instead of a
/// wall of seconds.
pub fn writeElapsed(writer: *std.Io.Writer, seconds: i64) !void {
    const secs = @mod(seconds, 60);
    const total_minutes = @divTrunc(seconds, 60);
    const mins = @mod(total_minutes, 60);
    const hours = @divTrunc(total_minutes, 60);
    if (hours > 0) {
        try writer.print("{d}h{d}m{d}s", .{ hours, mins, secs });
    } else if (mins > 0) {
        try writer.print("{d}m{d}s", .{ mins, secs });
    } else {
        try writer.print("{d}s", .{secs});
    }
}

test "elapsed time drops leading zero units" {
    var buffer: [32]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    try writeElapsed(&writer, 5);
    try writeElapsed(&writer, 18 * 60);
    try writeElapsed(&writer, 3723);
    try std.testing.expectEqualStrings("5s18m0s1h2m3s", writer.buffered());
}
