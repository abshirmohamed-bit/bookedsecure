import { describe, expect, it } from "vitest";
import {
  isoToLocalDateTimeInput,
  localDateTimeToIso,
  todayInZone,
  zoneOffsetMinutes,
} from "@/lib/business-time";

const SYDNEY = "Australia/Sydney";

describe("business time conversions", () => {
  it("stores 9am Sydney as the right UTC instant", () => {
    expect(localDateTimeToIso("2026-09-18T09:00", SYDNEY)).toBe("2026-09-17T23:00:00.000Z");
  });

  it("reads a stored instant back as the time the owner typed", () => {
    expect(isoToLocalDateTimeInput("2026-09-17T23:00:00.000Z", SYDNEY)).toBe("2026-09-18T09:00");
  });

  it("round-trips across the daylight-saving start", () => {
    // Sydney moves to +11:00 on 4 October 2026.
    expect(localDateTimeToIso("2026-10-05T09:00", SYDNEY)).toBe("2026-10-04T22:00:00.000Z");
    expect(isoToLocalDateTimeInput("2026-10-04T22:00:00.000Z", SYDNEY)).toBe("2026-10-05T09:00");
  });

  it("round-trips across the daylight-saving end", () => {
    expect(localDateTimeToIso("2026-04-06T09:00", SYDNEY)).toBe("2026-04-05T23:00:00.000Z");
    expect(isoToLocalDateTimeInput("2026-04-05T23:00:00.000Z", SYDNEY)).toBe("2026-04-06T09:00");
  });

  it("leaves values that already carry a timezone alone", () => {
    expect(localDateTimeToIso("2026-09-17T23:00:00.000Z", SYDNEY)).toBe("2026-09-17T23:00:00.000Z");
  });

  it("handles other business timezones", () => {
    expect(localDateTimeToIso("2026-09-18T09:00", "Australia/Perth")).toBe(
      "2026-09-18T01:00:00.000Z",
    );
    expect(zoneOffsetMinutes(new Date("2026-09-18T01:00:00Z"), "Australia/Perth")).toBe(480);
  });

  it("reports today in the business timezone", () => {
    expect(todayInZone(SYDNEY, new Date("2026-09-17T23:30:00Z"))).toBe("2026-09-18");
  });

  it("returns an empty field value for a missing timestamp", () => {
    expect(isoToLocalDateTimeInput(null, SYDNEY)).toBe("");
  });
});
