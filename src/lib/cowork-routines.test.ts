import { describe, expect, it } from "vitest";
import { describeSchedule, nextRunAt, reportPreview, routineRequest, routineTools, runsOn } from "@/lib/cowork-routines";

const SYD = "Australia/Sydney";

describe("nextRunAt", () => {
  it("runs later today when the time hasn't passed", () => {
    // 2026-11-16 is a Monday; 06:00 Sydney (AEDT, +11) = 2026-11-15T19:00Z
    const after = new Date("2026-11-15T19:00:00Z");
    expect(nextRunAt({ freq: "daily", at: "08:00" }, SYD, after)).toBe("2026-11-15T21:00:00.000Z");
  });

  it("moves to tomorrow once today's time has passed", () => {
    const after = new Date("2026-11-15T22:00:00Z"); // 09:00 Monday Sydney
    expect(nextRunAt({ freq: "daily", at: "08:00" }, SYD, after)).toBe("2026-11-16T21:00:00.000Z");
  });

  it("weekdays skip the weekend", () => {
    const after = new Date("2026-11-20T22:00:00Z"); // Saturday 09:00 Sydney
    expect(nextRunAt({ freq: "weekdays", at: "07:00" }, SYD, after)).toBe("2026-11-22T20:00:00.000Z"); // Monday 07:00
  });

  it("weekly picks the next chosen day", () => {
    const after = new Date("2026-11-16T00:00:00Z"); // Monday 11:00 Sydney
    expect(nextRunAt({ freq: "weekly", at: "08:00", weekdays: [1] }, SYD, after)).toBe("2026-11-22T21:00:00.000Z"); // next Monday
    expect(nextRunAt({ freq: "weekly", at: "08:00", weekdays: [3] }, SYD, after)).toBe("2026-11-17T21:00:00.000Z"); // Wednesday
  });

  it("monthly falls on the month's last day for 31", () => {
    const after = new Date("2027-02-01T00:00:00Z");
    const iso = nextRunAt({ freq: "monthly", at: "09:00", dayOfMonth: 31 }, SYD, after)!;
    // 28 Feb 2027 09:00 AEDT
    expect(iso).toBe("2027-02-27T22:00:00.000Z");
  });

  it("follows daylight saving changes in local time", () => {
    // Sydney leaves daylight saving on 4 April 2027: 08:00 is +11 before, +10 after.
    const before = nextRunAt({ freq: "daily", at: "08:00" }, SYD, new Date("2027-04-02T10:00:00Z")); // Fri 21:00 local
    const afterChange = nextRunAt({ freq: "daily", at: "08:00" }, SYD, new Date("2027-04-02T22:00:00Z")); // Sat 09:00 local
    expect(before).toBe("2027-04-02T21:00:00.000Z"); // Sat 08:00 +11
    expect(afterChange).toBe("2027-04-03T22:00:00.000Z"); // Sun 08:00 +10
  });

  it("returns null for an invalid schedule", () => {
    expect(nextRunAt({ freq: "daily", at: "25:00" }, SYD)).toBeNull();
  });
});

describe("runsOn", () => {
  it("knows weekdays", () => {
    expect(runsOn({ freq: "weekdays", at: "08:00" }, "2026-11-21")).toBe(false); // Saturday
    expect(runsOn({ freq: "weekdays", at: "08:00" }, "2026-11-20")).toBe(true); // Friday
  });
});

describe("describeSchedule", () => {
  it("reads like an owner would say it", () => {
    expect(describeSchedule({ freq: "weekly", at: "08:00", weekdays: [1] })).toBe("Every Monday at 8:00 am");
    expect(describeSchedule({ freq: "weekly", at: "17:30", weekdays: [5, 1] })).toBe("Every Monday and Friday at 5:30 pm");
    expect(describeSchedule({ freq: "monthly", at: "00:15", dayOfMonth: 2 })).toBe("Every month on the 2nd at 12:15 am");
    expect(describeSchedule({ freq: "weekdays", at: "12:00" })).toBe("Every weekday at 12:00 pm");
  });
});

describe("routineTools", () => {
  it("keeps reading and preparing tools only", () => {
    const all = { today_overview: 1, write_linkedin_post: 2, book_job: 3, publish_linkedin_post: 4, delete_routine: 5, clip_video_link: 6 };
    expect(Object.keys(routineTools(all)).sort()).toEqual(["today_overview", "write_linkedin_post"]);
  });
});

describe("routineRequest and reportPreview", () => {
  it("tells Co-Work nobody is watching", () => {
    const text = routineRequest("Monday numbers", "Send me last week's numbers");
    expect(text).toContain("not here right now");
    expect(text).toContain("Send me last week's numbers");
  });
  it("shortens long reports", () => {
    const long = "word ".repeat(100);
    const out = reportPreview(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
