import { describe, expect, it } from "vitest";
import { dayGroup, kindsForFilter, relativeTime, trialEndingSoon } from "./notifications";

const now = new Date("2026-10-26T10:00:00Z");

describe("notifications", () => {
  it("shows minutes ago", () => {
    expect(relativeTime("2026-10-26T09:55:00Z", now)).toBe("5 min ago");
  });
  it("groups older alerts as Earlier", () => {
    expect(dayGroup("2026-10-20T09:00:00Z", now)).toBe("Earlier");
  });
  it("bookings filter only covers booking kinds", () => {
    expect(kindsForFilter("bookings")).toEqual(["booking_confirmed", "booking_change_request"]);
  });
  it("trial reminder only within last 3 days", () => {
    expect(trialEndingSoon("trialing", "2026-10-28T10:00:00Z", now)).toBe(true);
    expect(trialEndingSoon("trialing", "2026-11-05T10:00:00Z", now)).toBe(false);
    expect(trialEndingSoon("active", "2026-10-28T10:00:00Z", now)).toBe(false);
  });
});
