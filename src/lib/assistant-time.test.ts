import { describe, expect, it } from "vitest";
import { assistantTimeZone, formatInZone, nowInZone, zonedWallTimeToIso } from "@/lib/assistant-time";

describe("assistantTimeZone", () => {
  it("keeps a real zone and falls back for anything else", () => {
    expect(assistantTimeZone("Australia/Perth")).toBe("Australia/Perth");
    expect(assistantTimeZone(null)).toBe("Australia/Sydney");
    expect(assistantTimeZone("Not/AZone")).toBe("Australia/Sydney");
  });
});

describe("zonedWallTimeToIso", () => {
  it("treats the time as the tenant's own local time", () => {
    // 19 September 2026, 9am in Sydney is AEST (UTC+10).
    expect(zonedWallTimeToIso("2026-09-19", "09:00", "Australia/Sydney")).toBe(
      "2026-09-18T23:00:00.000Z",
    );
    // Same wall time in Perth is UTC+8.
    expect(zonedWallTimeToIso("2026-09-19", "09:00", "Australia/Perth")).toBe(
      "2026-09-19T01:00:00.000Z",
    );
  });

  it("follows daylight saving", () => {
    expect(zonedWallTimeToIso("2026-01-15", "09:00", "Australia/Sydney")).toBe(
      "2026-01-14T22:00:00.000Z",
    );
  });

  it("refuses anything that is not a real date or time", () => {
    expect(zonedWallTimeToIso("19-09-2026", "09:00", "Australia/Sydney")).toBeNull();
    expect(zonedWallTimeToIso("2026-02-31", "09:00", "Australia/Sydney")).toBeNull();
    expect(zonedWallTimeToIso("2026-09-19", "9am", "Australia/Sydney")).toBeNull();
    expect(zonedWallTimeToIso("2026-09-19", "25:00", "Australia/Sydney")).toBeNull();
  });
});

describe("nowInZone", () => {
  it("reports the tenant's local date, time and weekday", () => {
    const local = nowInZone("Australia/Sydney", new Date("2026-09-18T23:30:00.000Z"));
    expect(local).toEqual({ date: "2026-09-19", time: "09:30", weekday: "Saturday" });
  });
});

describe("formatInZone", () => {
  it("reads back as the owner's own local time", () => {
    expect(formatInZone("2026-09-18T23:00:00.000Z", "Australia/Sydney")).toContain("9:00");
  });
});
