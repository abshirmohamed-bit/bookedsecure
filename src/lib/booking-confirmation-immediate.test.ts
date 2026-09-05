// The operational booking confirmation is transactional: a customer who has
// just booked is told immediately, at any hour. Nothing else gains that
// exemption.
import { describe, expect, it } from "vitest";
import {
  evaluateQuietHoursGate,
  isQuietHoursExemptTransactional,
} from "@/lib/sms/quiet-hours";
import { BOOKING_CONFIRMATION_TEMPLATE_ID } from "@/lib/booking-confirmation";

const GLOCAST = { timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 };

describe("transactional booking confirmation vs quiet hours", () => {
  it("the tenant window still blocks ordinary sends at 21:16 local", () => {
    const gate = evaluateQuietHoursGate(GLOCAST, new Date("2026-09-05T11:16:00.000Z"));
    expect(gate.blocked).toBe(true);
  });

  it("the booking-confirmation template is exempt on the operational path", () => {
    expect(
      isQuietHoursExemptTransactional({
        templateId: BOOKING_CONFIRMATION_TEMPLATE_ID,
        kind: "manual",
      }),
    ).toBe(true);
  });

  it("nothing promotional or automated is ever exempt", () => {
    expect(
      isQuietHoursExemptTransactional({ templateId: BOOKING_CONFIRMATION_TEMPLATE_ID, kind: "follow_up" }),
    ).toBe(false);
    expect(
      isQuietHoursExemptTransactional({ templateId: "contact_only_introduction_neutral", kind: "manual" }),
    ).toBe(false);
    expect(isQuietHoursExemptTransactional({ templateId: null, kind: "manual" })).toBe(false);
    expect(isQuietHoursExemptTransactional({ templateId: undefined, kind: "approved_reply" })).toBe(false);
  });
});
