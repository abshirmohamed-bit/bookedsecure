import { describe, expect, it } from "vitest";
import {
  isSlotStillAvailable,
  parseWeeklyWindows,
  resolveAvailableSlots,
  zonedWallClockToUtc,
  type AvailabilityConfig,
} from "@/lib/availability";

const SYDNEY = "Australia/Sydney";

function config(overrides: Partial<AvailabilityConfig> = {}): AvailabilityConfig {
  return {
    timezone: SYDNEY,
    active: true,
    slotMinutes: 120,
    leadTimeMinutes: 60,
    horizonDays: 7,
    offerTtlMinutes: 120,
    // Mon-Fri 09:00-15:00 wall clock.
    weeklyWindows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "15:00" })),
    quietHoursStart: 21,
    quietHoursEnd: 8,
    ...overrides,
  };
}

/** Wall clock in the tenant timezone, independent of the runner's TZ. */
function wallClock(iso: string, timezone = SYDNEY) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: get("minute") };
}

describe("timezone and DST conversion", () => {
  it("maps a wall-clock time to the correct UTC instant in AEST", () => {
    // July = AEST (UTC+10): 09:00 local is 23:00 UTC the previous day.
    expect(zonedWallClockToUtc(SYDNEY, 2025, 7, 15, 9 * 60)?.toISOString()).toBe("2025-07-14T23:00:00.000Z");
  });

  it("maps the same wall-clock time correctly in AEDT", () => {
    // January = AEDT (UTC+11): 09:00 local is 22:00 UTC the previous day.
    expect(zonedWallClockToUtc(SYDNEY, 2025, 1, 15, 9 * 60)?.toISOString()).toBe("2025-01-14T22:00:00.000Z");
  });

  it("keeps offered slots at the configured wall-clock hour across the DST boundary", () => {
    // Sydney DST begins Sun 5 Oct 2025. Offering across that week must keep 09:00 local.
    const slots = resolveAvailableSlots({
      config: config({ horizonDays: 14, slotMinutes: 360 }),
      now: new Date("2025-10-01T00:00:00.000Z"),
      occupiedStarts: [],
      limit: 20,
    });
    expect(slots.length).toBeGreaterThan(3);
    for (const slot of slots) {
      expect(wallClock(slot.start).hour).toBe(9);
    }
    // Slots exist on both sides of the transition and never repeat an instant.
    const before = slots.filter((slot) => slot.start < "2025-10-04T00:00:00.000Z");
    const after = slots.filter((slot) => slot.start > "2025-10-06T00:00:00.000Z");
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(slots.map((slot) => slot.start)).size).toBe(slots.length);
  });

  it("returns no slots for an invalid timezone rather than guessing", () => {
    const slots = resolveAvailableSlots({
      config: config({ timezone: "Not/AZone" }),
      now: new Date("2025-07-14T00:00:00.000Z"),
      occupiedStarts: [],
    });
    expect(slots).toEqual([]);
  });
});

describe("operating hours", () => {
  it("only offers slots inside configured weekly windows", () => {
    const slots = resolveAvailableSlots({
      config: config(),
      now: new Date("2025-07-14T00:00:00.000Z"),
      occupiedStarts: [],
      limit: 10,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const formatted = wallClock(slot.start);
      expect(["Sat", "Sun"]).not.toContain(formatted.weekday);
      expect(formatted.hour).toBeGreaterThanOrEqual(9);
      expect(formatted.hour).toBeLessThan(15);
    }
  });

  it("never offers a slot that would run past the end of the window", () => {
    // 09:00-15:00 with 4h slots fits 09:00 and 11:00 only (13:00 would end 17:00).
    const slots = resolveAvailableSlots({
      config: config({ slotMinutes: 240, horizonDays: 1 }),
      now: new Date("2025-07-14T00:00:00.000Z"), // Monday in Sydney
      occupiedStarts: [],
      limit: 10,
    });
    for (const slot of slots) {
      expect(wallClock(slot.end).hour).toBeLessThanOrEqual(15);
    }
  });

  it("offers nothing when there are no weekly windows", () => {
    expect(
      resolveAvailableSlots({
        config: config({ weeklyWindows: [] }),
        now: new Date("2025-07-14T00:00:00.000Z"),
        occupiedStarts: [],
      }),
    ).toEqual([]);
  });

  it("respects minimum notice and never offers a slot in the past", () => {
    const now = new Date("2025-07-14T00:30:00.000Z"); // 10:30 Monday Sydney
    const slots = resolveAvailableSlots({
      config: config({ leadTimeMinutes: 240, horizonDays: 2 }),
      now,
      occupiedStarts: [],
      limit: 5,
    });
    for (const slot of slots) {
      expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(
        now.getTime() + 240 * 60_000,
      );
    }
  });

  it("excludes slots that fall inside quiet hours", () => {
    const slots = resolveAvailableSlots({
      // Window spans into quiet hours (21:00 start).
      config: config({
        weeklyWindows: [{ weekday: 1, start: "18:00", end: "23:00" }],
        slotMinutes: 60,
        horizonDays: 8,
      }),
      now: new Date("2025-07-13T00:00:00.000Z"),
      occupiedStarts: [],
      limit: 10,
    });
    for (const slot of slots) {
      const hour = wallClock(slot.start).hour;
      expect(hour).toBeLessThan(21);
      expect(hour).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("occupied slot exclusion", () => {
  it("drops slots already taken by a booked job or accepted offer", () => {
    const base = resolveAvailableSlots({
      config: config(),
      now: new Date("2025-07-14T00:00:00.000Z"),
      occupiedStarts: [],
      limit: 3,
    });
    const taken = base[0]!.start;
    const filtered = resolveAvailableSlots({
      config: config(),
      now: new Date("2025-07-14T00:00:00.000Z"),
      occupiedStarts: [taken],
      limit: 3,
    });
    expect(filtered.map((slot) => slot.start)).not.toContain(taken);
  });

  it("limits the number of offered options", () => {
    const slots = resolveAvailableSlots({
      config: config({ horizonDays: 14 }),
      now: new Date("2025-07-14T00:00:00.000Z"),
      occupiedStarts: [],
    });
    expect(slots.length).toBeLessThanOrEqual(3);
  });
});

describe("re-validation at the moment of booking", () => {
  it("confirms a slot that is still free", () => {
    const now = new Date("2025-07-14T00:00:00.000Z");
    const slot = resolveAvailableSlots({ config: config(), now, occupiedStarts: [], limit: 1 })[0]!;
    const result = isSlotStillAvailable({
      config: config(),
      now,
      occupiedStarts: [],
      slotStart: slot.start,
    });
    expect(result.available).toBe(true);
    expect(result.slot?.start).toBe(slot.start);
  });

  it("rejects a slot that was taken in the meantime (race condition)", () => {
    const now = new Date("2025-07-14T00:00:00.000Z");
    const slot = resolveAvailableSlots({ config: config(), now, occupiedStarts: [], limit: 1 })[0]!;
    const result = isSlotStillAvailable({
      config: config(),
      now,
      occupiedStarts: [slot.start],
      slotStart: slot.start,
    });
    expect(result.available).toBe(false);
  });

  it("rejects a slot that no longer matches availability, e.g. windows changed", () => {
    const now = new Date("2025-07-14T00:00:00.000Z");
    const slot = resolveAvailableSlots({ config: config(), now, occupiedStarts: [], limit: 1 })[0]!;
    const result = isSlotStillAvailable({
      config: config({ weeklyWindows: [{ weekday: 6, start: "09:00", end: "12:00" }] }),
      now,
      occupiedStarts: [],
      slotStart: slot.start,
    });
    expect(result.available).toBe(false);
  });

  it("rejects a slot that is now in the past", () => {
    const now = new Date("2025-07-14T00:00:00.000Z");
    const slot = resolveAvailableSlots({ config: config(), now, occupiedStarts: [], limit: 1 })[0]!;
    const result = isSlotStillAvailable({
      config: config(),
      now: new Date("2025-07-21T00:00:00.000Z"),
      occupiedStarts: [],
      slotStart: slot.start,
    });
    expect(result.available).toBe(false);
  });
});

describe("window parsing hardening", () => {
  it("ignores malformed windows instead of offering bad times", () => {
    expect(
      parseWeeklyWindows([
        { weekday: 1, start: "09:00", end: "17:00" },
        { weekday: 9, start: "09:00", end: "17:00" },
        { weekday: 2, start: "17:00", end: "09:00" },
        { weekday: 3, start: "bad", end: "17:00" },
        null,
        "nope",
      ]),
    ).toEqual([{ weekday: 1, start: "09:00", end: "17:00" }]);
  });
});
