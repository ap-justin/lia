//! The pieces of the trace report format that the crash record shares with the
//! trace report, kept apart so a crash record does not load the trace builder.

const std = @import("std");

pub const format_version: u32 = 1;

pub const notice_text = "Private diagnostic report. It may include prompts, file paths, command output, and file snippets.";

pub fn formatUtc(buf: []u8, ms: i64) ![]const u8 {
    const secs: u64 = @intCast(@divFloor(ms, 1000));
    const ms_part: u64 = @intCast(@mod(ms, 1000));
    const epoch_secs: std.time.epoch.EpochSeconds = .{ .secs = secs };
    const day_seconds = epoch_secs.getDaySeconds();
    const year_day = epoch_secs.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    return std.mem.print(buf, "{d}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.{d:0>3}Z", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(),
        day_seconds.getMinutesIntoHour(),
        day_seconds.getSecondsIntoMinute(),
        ms_part,
    });
}
