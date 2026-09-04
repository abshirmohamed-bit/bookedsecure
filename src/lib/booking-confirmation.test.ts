import { describe, expect, it } from "vitest";
import {
  BOOKING_CONFIRMATION_TEMPLATE_ID,
  confirmationJobIdempotencyKey,
  confirmationReleaseAt,
  evaluateConfirmationEligibility,
  formatConfirmationDateTime,
  renderBookingConfirmation,
  resolveTenantCallbackNumber,
  zonedWallTimeToUtc,
} from "@/lib/booking-confirmation";

const SYDNEY = { timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 };
const PERTH = { timezone: "Australia/Perth", quiet_hours_start: 20, quiet_hours_end: 7 };

const eligible = {
  offerStatus: "confirmed",
  jobId: "job-1",
  confirmationSentAt: null,
  consentStatus: "granted",
  optedOutAt: null,
  smsSuppressedAt: null,
  mobileNumber: "+61466907824",
  tenantCallbackNumber: "+61468045220",
};

describe("tenant callback number", () => {
  it("uses the tenant's own configured number", () => {
    expect(resolveTenantCallbackNumber({ phone_number: "0468 045 220" })).toBe("+61468045220");
  });
  it("never substitutes a default when missing or invalid", () => {
    expect(resolveTenantCallbackNumber({ phone_number: null })).toBeNull();
    expect(resolveTenantCallbackNumber({ phone_number: "12345" })).toBeNull();
  });
});

describe("confirmation eligibility", () => {
  it("allows a committed booking with consent and a callback number", () => {
    expect(evaluateConfirmationEligibility(eligible)).toMatchObject({ outcome: "eligible", sendable: true });
  });
  it("blocks without a committed booking", () => {
    expect(evaluateConfirmationEligibility({ ...eligible, jobId: null }).outcome).toBe("blocked_no_booking");
    expect(evaluateConfirmationEligibility({ ...eligible, offerStatus: "offered" }).outcome).toBe("blocked_no_booking");
  });
  it("blocks a cancelled booking", () => {
    expect(evaluateConfirmationEligibility({ ...eligible, offerStatus: "withdrawn" }).outcome).toBe("blocked_cancelled");
  });
  it("suppresses a duplicate", () => {
    expect(
      evaluateConfirmationEligibility({ ...eligible, confirmationSentAt: "2026-01-01T00:00:00Z" }).outcome,
    ).toBe("duplicate_suppressed");
  });
  it("blocks opt-out, suppression, bad number and missing consent", () => {
    expect(evaluateConfirmationEligibility({ ...eligible, optedOutAt: "x" }).outcome).toBe("blocked_opted_out");
    expect(evaluateConfirmationEligibility({ ...eligible, smsSuppressedAt: "x" }).outcome).toBe("blocked_suppressed");
    expect(evaluateConfirmationEligibility({ ...eligible, mobileNumber: "abc" }).outcome).toBe("blocked_invalid_number");
    expect(evaluateConfirmationEligibility({ ...eligible, consentStatus: "pending" }).outcome).toBe(
      "blocked_consent_missing",
    );
  });
  it("blocks when the tenant has no callback number, without substituting one", () => {
    const decision = evaluateConfirmationEligibility({ ...eligible, tenantCallbackNumber: null });
    expect(decision.outcome).toBe("blocked_missing_callback_number");
    expect(decision.sendable).toBe(false);
  });
});

describe("versioned template", () => {
  it("renders every required field in tenant time with STOP and callback", () => {
    const { body, templateId } = renderBookingConfirmation({
      customerName: "Abshir Ahmed",
      tenantName: "Glocast",
      serviceName: "Full Detail",
      slotStart: "2026-09-10T23:00:00Z",
      timezone: "Australia/Sydney",
      callbackNumber: "+61468045220",
    });
    expect(templateId).toBe(BOOKING_CONFIRMATION_TEMPLATE_ID);
    expect(body).toContain("Abshir");
    expect(body).toContain("Glocast");
    expect(body).toContain("Full Detail");
    expect(body).toContain("9:00 am");
    expect(body).toContain("+61468045220");
    expect(body).toContain("Reply STOP");
    expect(body).not.toContain("{{");
  });
  it("formats in each tenant's own timezone", () => {
    expect(formatConfirmationDateTime("2026-09-10T23:00:00Z", "Australia/Sydney").time).toBe("9:00 am");
    expect(formatConfirmationDateTime("2026-09-10T23:00:00Z", "Australia/Perth").time).toBe("7:00 am");
  });
});

describe("overnight queueing", () => {
  it("sends immediately outside quiet hours", () => {
    expect(confirmationReleaseAt(SYDNEY, new Date("2026-09-10T04:00:00Z"))).toBeNull(); // 2pm Sydney
  });
  it("queues a late-night booking until the quiet window ends the next morning", () => {
    const release = confirmationReleaseAt(SYDNEY, new Date("2026-09-10T13:09:00Z")); // 11:09pm Sydney
    expect(release?.toISOString()).toBe("2026-09-10T22:00:00.000Z"); // 8am Sydney, 11 Sep
  });
  it("queues an early-morning booking until the same morning", () => {
    const release = confirmationReleaseAt(SYDNEY, new Date("2026-09-10T19:00:00Z")); // 5am Sydney 11 Sep
    expect(release?.toISOString()).toBe("2026-09-10T22:00:00.000Z");
  });
  it("respects a different tenant's window and timezone", () => {
    const release = confirmationReleaseAt(PERTH, new Date("2026-09-10T15:00:00Z")); // 11pm Perth
    expect(release?.toISOString()).toBe("2026-09-10T23:00:00.000Z"); // 7am Perth
  });
  it("resolves wall time across a DST boundary", () => {
    // Sydney moves to AEDT on 4 Oct 2026.
    expect(zonedWallTimeToUtc("Australia/Sydney", 2026, 10, 5, 8).toISOString()).toBe("2026-10-04T21:00:00.000Z");
  });
  it("keys the release job to the booking so a replay cannot double-send", () => {
    expect(confirmationJobIdempotencyKey("offer-1")).toBe("booking_confirmation_release:offer-1");
    expect(confirmationJobIdempotencyKey("offer-1")).toBe(confirmationJobIdempotencyKey("offer-1"));
  });
});
