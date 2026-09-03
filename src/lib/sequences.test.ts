import { describe, expect, it } from "vitest";
import { LEAD_CONTEXTS, type LeadContext } from "./lead-provenance";
import { evaluateSequences, selectSequence, type SequenceDecisionInput } from "./sequences";

const base = (leadContext: LeadContext, over: Partial<SequenceDecisionInput> = {}): SequenceDecisionInput => ({
  leadContext,
  consentStatus: "granted",
  bookingStatus: "none",
  hasBookingLink: true,
  ...over,
});

describe("selectSequence — hard stops", () => {
  it("opt-out blocks every context", () => {
    for (const ctx of LEAD_CONTEXTS) {
      const d = selectSequence(base(ctx, { consentStatus: "opted_out", explicitBookingIntent: true }));
      expect(d.sequence).toBe("none");
      expect(d.consentRequired).toBe("blocked");
    }
  });

  it("suppression blocks", () => {
    expect(selectSequence(base("active_form_enquiry", { consentStatus: "suppressed" })).consentRequired).toBe("blocked");
  });

  it("tenant takeover hands off", () => {
    const d = selectSequence(base("active_form_enquiry", { tenantTakeover: true, explicitBookingIntent: true }));
    expect(d.sequence).toBe("human_handoff");
    expect(d.handoff).toBe(true);
  });

  it("pause and disabled agent select nothing", () => {
    expect(selectSequence(base("active_form_enquiry", { automationPaused: true })).sequence).toBe("none");
    expect(selectSequence(base("active_form_enquiry", { agentEnabled: false })).sequence).toBe("none");
  });
});

describe("selectSequence — escalations", () => {
  it("human request, unsupported request and tool failure hand off", () => {
    for (const over of [{ requestedHuman: true }, { unsupportedRequest: true }, { toolFailure: true }]) {
      expect(selectSequence(base("active_form_enquiry", over)).sequence).toBe("human_handoff");
    }
  });

  it("owner review and conflicting context hand off", () => {
    expect(selectSequence(base("owner_review")).sequence).toBe("human_handoff");
    expect(selectSequence(base("previous_customer", { conflictingContext: true })).sequence).toBe("human_handoff");
  });

  it("quote request on a contact-only lead hands off", () => {
    const d = selectSequence(base("contact_only_unqualified", { requestedQuote: true }));
    expect(d.sequence).toBe("human_handoff");
    expect(d.certainty).toBe("probable");
  });
});

describe("selectSequence — booking intent", () => {
  it("sparse lead with booking intent goes straight to the booking link", () => {
    const d = selectSequence(base("contact_only_unqualified", { explicitBookingIntent: true, consentStatus: "unknown" }));
    expect(d.sequence).toBe("booking_intent_fast_path");
    expect(d.consentRequired).toBe("consent_capture_required");
    expect(d.neutralLanguageRequired).toBe(true);
  });

  it("historical lead with booking intent skips qualification", () => {
    expect(selectSequence(base("verified_historical_enquiry", { explicitBookingIntent: true })).sequence).toBe(
      "booking_intent_fast_path",
    );
  });

  it("missing booking link hands off instead of guessing", () => {
    expect(
      selectSequence(base("contact_only_unqualified", { explicitBookingIntent: true, hasBookingLink: false })).sequence,
    ).toBe("human_handoff");
  });
});

describe("selectSequence — context mapping", () => {
  it("covers every lead context deterministically", () => {
    for (const ctx of LEAD_CONTEXTS) {
      const d = selectSequence(base(ctx));
      expect(d.reason.length).toBeGreaterThan(0);
      expect(d.wouldSend).toBe(false);
      if (ctx !== "owner_review") expect(d.certainty).toBe("certain");
    }
  });

  it("maps the key contexts to their sequences", () => {
    expect(selectSequence(base("quote_chat_lead")).sequence).toBe("quote_chat_completion");
    expect(selectSequence(base("active_form_enquiry")).sequence).toBe("active_enquiry_qualification");
    expect(selectSequence(base("abandoned_quote")).sequence).toBe("abandoned_quote_recovery");
    expect(selectSequence(base("verified_historical_enquiry")).sequence).toBe("historical_booking_link");
    expect(selectSequence(base("previous_customer", { bookingStatus: "completed" })).sequence).toBe(
      "previous_customer_reactivation",
    );
    expect(selectSequence(base("contact_only_unqualified")).sequence).toBe("contact_only_introduction");
    expect(selectSequence(base("booked_lead", { bookingStatus: "scheduled" })).sequence).toBe(
      "booking_confirmation_followup",
    );
  });

  it("sparse contexts always require neutral language", () => {
    for (const ctx of ["contact_only_unqualified", "manually_added_contact", "cold_lead"] as const) {
      expect(selectSequence(base(ctx)).neutralLanguageRequired).toBe(true);
    }
    expect(selectSequence(base("verified_historical_enquiry")).neutralLanguageRequired).toBe(false);
  });

  it("is a pure function of its input", () => {
    const input = base("active_form_enquiry");
    expect(selectSequence(input)).toEqual(selectSequence(input));
  });
});

describe("evaluateSequences", () => {
  it("evaluates a synthetic batch without side effects", () => {
    const rows = evaluateSequences(LEAD_CONTEXTS.map((c) => base(c)));
    expect(rows).toHaveLength(LEAD_CONTEXTS.length);
    expect(rows.every((r) => r.decision.wouldSend === false)).toBe(true);
  });
});
