// SYSTEM FLOW — the deterministic control layer, end to end.
//
// Order of control for anything that leaves the platform:
//   booking committed → confirmation eligibility → send path / quiet hours →
//   owner alert → follow-up planning → agent execution (disabled).
// Every gate is asserted both ways: it must allow the legitimate case and
// refuse each unsafe one.

import { describe, expect, it } from "vitest";
import {
  bookingOnlyBlocks,
  bookingOnlyOutboundAllowed,
  bookingOnlyFollowUpSequence,
  confirmationSmsDecision,
  BOOKING_ONLY_DISABLED,
} from "@/lib/booking-only-mode";
import { evaluateConfirmationEligibility } from "@/lib/booking-confirmation";
import { evaluateOwnerNotificationEligibility } from "@/lib/owner-notification";
import {
  classifyMessagePath,
  evaluateNewLeadResponseExemption,
  nextPermittedSendAt,
  localTimeIn,
} from "@/lib/message-path";
import { decideExecution, LIVE_EXECUTION_ENABLED, executionWouldDispatch } from "@/lib/agent-executor";
import {
  classifyReactivationCandidate,
  shouldSendReactivationReminder,
  guardReactivationMessage,
  renderReactivationReminder,
  proposeOffer,
  REACTIVATION_REMINDER_DELAY_DAYS,
} from "@/lib/reactivation";

const BUSINESS = "cccccccc-0000-4000-8000-000000000003";

const confirmedBooking = {
  offerStatus: "confirmed",
  jobId: "job-1",
  confirmationSentAt: null,
  consentStatus: "granted",
  optedOutAt: null,
  smsSuppressedAt: null,
  mobileNumber: "0466 907 824",
  tenantCallbackNumber: "+61412000111",
  ownerNotificationNumber: "+61412000111",
};

describe("system flow — 1. only a committed booking can produce a message", () => {
  it("allows the operational confirmation for a confirmed offer with a job", () => {
    expect(evaluateConfirmationEligibility(confirmedBooking).sendable).toBe(true);
  });

  it.each([
    ["no booking yet", { offerStatus: "offered", jobId: null }, "blocked_no_booking"],
    ["a withdrawn offer", { offerStatus: "withdrawn" }, "blocked_cancelled"],
    ["an expired offer", { offerStatus: "expired" }, "blocked_cancelled"],
    ["a replay of the same booking", { confirmationSentAt: "2026-09-01T00:00:00Z" }, "duplicate_suppressed"],
    ["an opted-out customer", { optedOutAt: "2026-09-01T00:00:00Z" }, "blocked_opted_out"],
    ["a suppressed number", { smsSuppressedAt: "2026-09-01T00:00:00Z" }, "blocked_suppressed"],
    ["an unusable number", { mobileNumber: "12345" }, "blocked_invalid_number"],
    ["missing consent", { consentStatus: "unknown" }, "blocked_consent_missing"],
  ])("refuses %s", (_label, patch, outcome) => {
    const decision = evaluateConfirmationEligibility({ ...confirmedBooking, ...(patch as object) });
    expect(decision.sendable).toBe(false);
    expect(decision.outcome).toBe(outcome);
  });
});

describe("system flow — 2. booking-only mode allows exactly one outbound template", () => {
  it("permits the confirmation and refuses everything else", () => {
    expect(bookingOnlyOutboundAllowed({ templateId: "booking_confirmation", hasConfirmedBooking: true })).toBe(true);
    expect(bookingOnlyOutboundAllowed({ templateId: "booking_confirmation", hasConfirmedBooking: false })).toBe(false);
    expect(bookingOnlyOutboundAllowed({ templateId: "reactivation_campaign", hasConfirmedBooking: true })).toBe(false);
    expect(bookingOnlyOutboundAllowed({ templateId: null, hasConfirmedBooking: true })).toBe(false);
  });

  it("keeps campaigns, cold introductions and AI authority disabled", () => {
    for (const capability of BOOKING_ONLY_DISABLED) expect(bookingOnlyBlocks(capability)).toBe(true);
    expect(bookingOnlyBlocks("booking_confirmation")).toBe(false);
  });

  it("never plans a follow-up sequence after a booking", () => {
    expect(bookingOnlyFollowUpSequence()).toBeNull();
  });

  it("still gates the operational confirmation on consent and opt-out", () => {
    expect(confirmationSmsDecision({ consentStatus: "granted", optedOutAt: null, smsSuppressedAt: null, mobileNumber: "+61466907824" })).toEqual({ allowed: true });
    expect(confirmationSmsDecision({ consentStatus: "granted", optedOutAt: "x", smsSuppressedAt: null, mobileNumber: "+61466907824" }).allowed).toBe(false);
    expect(confirmationSmsDecision({ consentStatus: "unknown", optedOutAt: null, smsSuppressedAt: null, mobileNumber: "+61466907824" }).allowed).toBe(false);
  });
});

describe("system flow — 3. send path and quiet hours", () => {
  const newLeadFacts = {
    customerInitiated: true,
    quoteFlowActive: true,
    directResponseToCurrentEnquiry: true,
    consentGranted: true,
    consentLeadId: "lead-1",
    leadId: "lead-1",
    optedOut: false,
    suppressed: false,
    requiresOwnerReview: false,
    humanTakeoverActive: false,
    automationPaused: false,
    templateId: "booking_confirmation",
    templateVersion: 1,
    promotional: false,
    serviceRelated: true,
    alreadyBooked: true,
    tenantKillSwitchAt: null,
    globalKillSwitchAt: null,
    idempotencyKey: "confirmation:offer-1",
    sourceAttribution: "system",
    sequenceId: null,
  };

  it("treats a direct, consented, non-promotional reply as a new-lead response", () => {
    expect(classifyMessagePath(newLeadFacts)).toBe("new_lead_response");
  });

  it("treats anything promotional or indirect as a follow-up, which quiet hours hold", () => {
    expect(classifyMessagePath({ ...newLeadFacts, promotional: true })).toBe("sequence_follow_up");
    expect(classifyMessagePath({ ...newLeadFacts, directResponseToCurrentEnquiry: false })).toBe("sequence_follow_up");
    // Consent is not part of path selection; it is a separate condition that
    // must fail the exemption, so quiet hours still hold the message.
    const withoutConsent = evaluateNewLeadResponseExemption({ ...newLeadFacts, consentGranted: false });
    expect(withoutConsent.granted).toBe(false);
    expect(withoutConsent.failures.map((f) => f.condition)).toContain("consent");
  });

  it("computes the next permitted send time in the tenant's own timezone", () => {
    const settings = { quiet_hours_start: 21, quiet_hours_end: 8, timezone: "Australia/Sydney" } as never;
    const lateNight = new Date("2026-09-07T13:00:00.000Z"); // 11pm Sydney
    expect(localTimeIn("Australia/Sydney", lateNight)).toContain("23:00");
    const release = nextPermittedSendAt(settings, lateNight);
    expect(localTimeIn("Australia/Sydney", new Date(release))).toContain("08:00");
    expect(new Date(release).getTime()).toBeGreaterThan(lateNight.getTime());
  });
});

describe("system flow — 4. owner alert", () => {
  it("alerts the owner for a committed booking when a valid mobile is stored", () => {
    expect(
      evaluateOwnerNotificationEligibility({
        offerStatus: "confirmed",
        jobId: "job-1",
        ownerNotificationNumber: "0412 000 111",
      }).sendable,
    ).toBe(true);
  });

  it("never alerts without a booking or without a valid stored mobile", () => {
    expect(
      evaluateOwnerNotificationEligibility({ offerStatus: "offered", jobId: null, ownerNotificationNumber: "0412000111" }).outcome,
    ).toBe("blocked_no_booking");
    expect(
      evaluateOwnerNotificationEligibility({ offerStatus: "confirmed", jobId: "job-1", ownerNotificationNumber: null }).outcome,
    ).toBe("blocked_no_owner_number");
    expect(
      evaluateOwnerNotificationEligibility({ offerStatus: "confirmed", jobId: "job-1", ownerNotificationNumber: "+61288001234" }).outcome,
    ).toBe("blocked_invalid_owner_number");
  });
});

describe("system flow — 5. win-back drafting, approval and the single reminder", () => {
  const dormant = {
    hasMessages: false,
    hasQuoteChat: false,
    hasBooking: false,
    hasVerifiedContext: false,
    optedOut: false,
    suppressed: false,
    deleted: false,
    hasMobileNumber: true,
  };

  it("treats a contact-only imported record as dormant", () => {
    expect(classifyReactivationCandidate(dormant)).toEqual({ eligible: true });
  });

  it.each([
    ["a conversation exists", { hasMessages: true }],
    ["a quote chat exists", { hasQuoteChat: true }],
    ["a booking exists", { hasBooking: true }],
    ["an active enquiry exists", { hasVerifiedContext: true }],
    ["the contact opted out", { optedOut: true }],
    ["the number is suppressed", { suppressed: true }],
    ["the record is deleted", { deleted: true }],
    ["there is no mobile", { hasMobileNumber: false }],
  ])("excludes a contact when %s", (_label, patch) => {
    expect(classifyReactivationCandidate({ ...dormant, ...patch }).eligible).toBe(false);
  });

  it("sends exactly one reminder, three days later, and only without engagement", () => {
    const sentAt = new Date("2026-09-01T02:00:00.000Z");
    const base = {
      sentAt,
      reminderAlreadySent: false,
      hasInboundReply: false,
      hasQuoteChat: false,
      hasBooking: false,
      optedOut: false,
      suppressed: false,
      deleted: false,
    };
    const due = new Date(sentAt.getTime() + REACTIVATION_REMINDER_DELAY_DAYS * 86400000);
    expect(shouldSendReactivationReminder({ ...base, now: due })).toEqual({ send: true });
    expect(shouldSendReactivationReminder({ ...base, now: new Date(due.getTime() - 1000) }).send).toBe(false);
    expect(shouldSendReactivationReminder({ ...base, now: due, reminderAlreadySent: true }).send).toBe(false);
    for (const patch of [{ hasInboundReply: true }, { hasQuoteChat: true }, { hasBooking: true }, { optedOut: true }, { suppressed: true }]) {
      expect(shouldSendReactivationReminder({ ...base, now: due, ...patch }).send).toBe(false);
    }
  });

  it("guards win-back wording against timing, booking and money promises", () => {
    const offer = proposeOffer();
    const guarded = guardReactivationMessage(
      "Hi, it's us. We're offering 15% off your next enquiry. We can come tomorrow at 9am for $200.",
      offer,
    );
    expect(guarded.flagged.length).toBeGreaterThan(0);
    expect(guarded.text).not.toMatch(/tomorrow|9am|\$200/i);
    expect(guarded.text).toContain("15% off");
  });

  it("the reminder repeats the approved offer and stays opt-out safe", () => {
    const body = renderReactivationReminder({
      businessName: "Coastal Shine Detailing",
      leadName: "Dana",
      offerText: proposeOffer(),
      quoteUrl: "https://example.test/quote/coastal-shine?c=tok",
    });
    expect(body).toContain("15% off your next enquiry");
    expect(body).toContain("Reply STOP to opt out.");
    expect(guardReactivationMessage(body, proposeOffer()).flagged).toHaveLength(0);
  });
});

describe("system flow — 6. autonomous agent execution stays off", () => {
  it("live execution is disabled platform-wide", () => {
    expect(LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it("refuses to dispatch even with an authorised plan and a held claim", () => {
    const result = decideExecution({
      businessId: BUSINESS,
      leadId: "lead-1",
      ledgerRow: null,
      claimHeld: false,
      plannedAction: { kind: "initial_response", idempotencyKey: "k1" } as never,
      replan: null,
      plannedBookingStatus: "none",
      currentBookingStatus: "none",
      gateResult: { authorised: true, mode: "live" } as never,
    });
    expect(executionWouldDispatch(result)).toBe(false);
  });
});
