import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOOKING_ONLY_ALLOWED_TEMPLATE,
  BOOKING_ONLY_DISABLED,
  bookingOnlyBlocks,
  bookingOnlyFollowUpSequence,
  bookingOnlyOutboundAllowed,
  confirmationSmsDecision,
  isBookingOnlyTenant,
  ownerBookingAlert,
} from "./booking-only-mode";

const GLOCAST = "11111111-1111-1111-1111-111111111111";

describe("booking-only tenant scope", () => {
  it("applies to every tenant, present and future", () => {
    expect(isBookingOnlyTenant(GLOCAST)).toBe(true);
    expect(isBookingOnlyTenant("22222222-2222-2222-2222-222222222222")).toBe(true);
    expect(isBookingOnlyTenant("99999999-9999-9999-9999-999999999999")).toBe(true);
  });

  it("never treats a missing tenant id as authorised", () => {
    expect(isBookingOnlyTenant("")).toBe(false);
    expect(isBookingOnlyTenant("   ")).toBe(false);
  });
});


describe("disabled capabilities", () => {
  it("keeps every campaign / promotional / AI-authority capability disabled", () => {
    for (const capability of [
      "new_lead_sms_campaign",
      "contact_only_introduction",
      "follow_up_sequence",
      "reactivation_campaign",
      "historical_crm_campaign",
      "bulk_campaign",
      "promotional_sms",
      "ai_free_form_sms",
      "ai_general_outbound",
      "ai_pricing_authority",
      "ai_discount_authority",
      "ai_owner_settings_authority",
    ]) {
      expect(bookingOnlyBlocks(capability)).toBe(true);
      expect(BOOKING_ONLY_DISABLED).toContain(capability);
    }
  });

  it("never plans a follow-up sequence after a booking", () => {
    expect(bookingOnlyFollowUpSequence()).toBeNull();
  });
});

describe("outbound allow-list", () => {
  it("permits only the operational confirmation for a confirmed booking", () => {
    expect(
      bookingOnlyOutboundAllowed({ templateId: BOOKING_ONLY_ALLOWED_TEMPLATE, hasConfirmedBooking: true }),
    ).toBe(true);
    expect(
      bookingOnlyOutboundAllowed({ templateId: BOOKING_ONLY_ALLOWED_TEMPLATE, hasConfirmedBooking: false }),
    ).toBe(false);
    for (const template of [
      "contact_only_introduction_neutral",
      "active_enquiry_qualification_step",
      "slot_offer",
      null,
    ]) {
      expect(bookingOnlyOutboundAllowed({ templateId: template, hasConfirmedBooking: true })).toBe(false);
    }
  });
});

describe("confirmation SMS gating", () => {
  const base = {
    consentStatus: "granted",
    optedOutAt: null,
    smsSuppressedAt: null,
    mobileNumber: "+61466907824",
  };

  it("allows a consented, reachable lead", () => {
    expect(confirmationSmsDecision(base)).toEqual({ allowed: true });
  });

  it("blocks STOP, suppression, missing consent and missing number", () => {
    expect(confirmationSmsDecision({ ...base, optedOutAt: "2026-09-01T00:00:00Z" })).toEqual({
      allowed: false,
      reason: "opted_out",
    });
    expect(confirmationSmsDecision({ ...base, smsSuppressedAt: "2026-09-01T00:00:00Z" })).toEqual({
      allowed: false,
      reason: "suppressed",
    });
    expect(confirmationSmsDecision({ ...base, consentStatus: "unknown" })).toEqual({
      allowed: false,
      reason: "consent_missing",
    });
    expect(confirmationSmsDecision({ ...base, mobileNumber: null })).toEqual({
      allowed: false,
      reason: "no_number",
    });
  });
});

describe("owner alert", () => {
  it("is tenant + offer scoped and stable across replays", () => {
    const args = {
      businessId: GLOCAST,
      leadId: "lead-1",
      offerId: "offer-1",
      customerName: "Abshir",
      serviceName: "Full Interior Detail",
      slotLabel: "Mon 7 Sep, 9:00 am",
    };
    const first = ownerBookingAlert(args);
    expect(first.idempotencyKey).toBe(`booking_confirmed:${GLOCAST}:offer-1`);
    expect(ownerBookingAlert(args).idempotencyKey).toBe(first.idempotencyKey);
    expect(ownerBookingAlert({ ...args, offerId: "offer-2" }).idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    expect(first.body).toContain("Abshir");
    expect(first.body).toContain("Full Interior Detail");
  });
});

describe("no forbidden writes in the booking-only applier", () => {
  const source = readFileSync("src/lib/booking-only.server.ts", "utf8");

  it("never writes booking, job, consent, campaign, cap or kill-switch state", () => {
    for (const forbidden of [
      'from("jobs")',
      'from("sequence_campaigns")',
      'from("agent_actions")',
      'from("automation_jobs")',
      'from("consent_events")',
      "agent_daily_send_cap",
      "agent_kill_switch",
      "requires_owner_review",
      "quote_status",
      "booking_status",
      "completion_status",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("only ever updates the confirmation columns on the offer", () => {
    expect(source).toContain("confirmation_sms_sent_at");
    expect(source).not.toContain('status: "confirmed"');
  });
});
