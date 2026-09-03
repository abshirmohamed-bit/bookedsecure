import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LeadContext } from "./lead-provenance";
import { selectSequence, type SequenceDecisionInput } from "./sequences";
import {
  HISTORY_IMPLYING_TEMPLATES,
  FOLLOW_UP_OFFSETS_MINUTES,
  PLAN_MODE,
  TenantMismatchError,
  planSequenceActions,
  templateAllowed,
  type PlanFacts,
  type SequencePlan,
} from "./sequence-actions";

const BUSINESS = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";

const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  businessId: BUSINESS,
  leadId: LEAD,
  leadBusinessId: BUSINESS,
  leadContext: "active_form_enquiry",
  quietHoursNow: false,
  hasBookingLink: true,
  bookableServiceValid: true,
  followUpRuleSteps: [1, 2, 3],
  consentGranted: true,
  agentEnabled: true,
  ...over,
});

const plan = (
  decisionInput: SequenceDecisionInput,
  over: Partial<PlanFacts> = {},
): SequencePlan =>
  planSequenceActions({
    decision: selectSequence(decisionInput),
    facts: facts({ leadContext: decisionInput.leadContext, ...over }),
  });

const input = (
  leadContext: LeadContext,
  over: Partial<SequenceDecisionInput> = {},
): SequenceDecisionInput => ({
  leadContext,
  consentStatus: "granted",
  bookingStatus: "none",
  hasBookingLink: true,
  ...over,
});

describe("dry-run guarantees", () => {
  it("mode is always dry_run and nothing would send", () => {
    const p = plan(input("active_form_enquiry"));
    expect(p.mode).toBe(PLAN_MODE);
    expect(PLAN_MODE).toBe("dry_run");
    expect(p.wouldSend).toBe(false);
    expect(p.actions.every((a) => a.wouldSend === false)).toBe(true);
    expect(p.actions.every((a) => a.eligible === false)).toBe(true);
  });

  it("never emits a booking_confirm action for any context", () => {
    const contexts: LeadContext[] = [
      "quote_chat_lead",
      "active_form_enquiry",
      "active_conversation",
      "campaign_reply",
      "abandoned_quote",
      "verified_historical_enquiry",
      "previous_customer",
      "contact_only_unqualified",
      "manually_added_contact",
      "cold_lead",
      "booked_lead",
      "owner_review",
    ];
    for (const ctx of contexts) {
      const kinds = plan(input(ctx)).actions.map((a) => a.kind);
      expect(kinds).not.toContain("booking_confirm");
    }
  });

  it("the planner module contains no send, enqueue or write call", () => {
    const src = readFileSync("src/lib/sequence-plan.server.ts", "utf8");
    for (const forbidden of [
      "sendSms",
      "enqueueJob",
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      "commitWebChatBooking",
      "sendSlotOffer",
      "getProvider",
    ]) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).toContain('mode is hard-coded to "dry_run"');
  });
});

describe("hard stops zero the plan", () => {
  const cases: Array<[string, SequenceDecisionInput, Partial<PlanFacts>]> = [
    ["opted out", input("active_form_enquiry", { consentStatus: "opted_out" }), { optedOut: true }],
    ["suppressed", input("active_form_enquiry", { consentStatus: "suppressed" }), { suppressed: true }],
    ["declined", input("active_form_enquiry", { consentStatus: "declined" }), {}],
    ["takeover", input("active_form_enquiry", { tenantTakeover: true }), { tenantTakeover: true }],
    ["paused", input("active_form_enquiry", { automationPaused: true }), { automationPaused: true }],
    ["agent off", input("active_form_enquiry", { agentEnabled: false }), { agentEnabled: false }],
  ];

  it.each(cases)("%s produces only a blocked no_action", (_label, decisionInput, over) => {
    const p = plan(decisionInput, over);
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0]!.kind).toBe("no_action");
    expect(p.actions[0]!.blockedReason).not.toBeNull();
    expect(p.blockedReasons.length).toBeGreaterThan(0);
  });
});

describe("handoff", () => {
  it("plans handoff only, with no customer message, notification or audit write", () => {
    const p = plan(input("owner_review"));
    expect(p.sequence).toBe("human_handoff");
    expect(p.actions.map((a) => a.kind)).toEqual(["handoff"]);
    const a = p.actions[0]!;
    expect(a.templateId).toBeNull();
    expect(a.eligible).toBe(false);
    expect(a.preconditions.join(" ")).toContain("no notification row");
  });

  it("tool failure escalates to a planned handoff", () => {
    const p = plan(input("active_form_enquiry", { toolFailure: true }), { toolFailure: true });
    expect(p.actions.map((a) => a.kind)).toEqual(["handoff"]);
    expect(p.actions[0]!.blockedReason).toBe("tool_failure");
  });
});

describe("booking_confirmation_followup", () => {
  it("plans nothing: no send, offer, schedule, handoff or booking action", () => {
    const p = plan(input("booked_lead", { bookingStatus: "scheduled" }));
    expect(p.sequence).toBe("booking_confirmation_followup");
    expect(p.actions.map((a) => a.kind)).toEqual(["no_action"]);
    expect(p.actions[0]!.blockedReason).toBe("post_booking_state");
    expect(p.actions[0]!.preconditions.join(" ")).toContain("commitWebChatBooking");
  });
});

describe("consent ordering", () => {
  it("consent_capture_required puts consent first and blocks content", () => {
    const p = plan(input("contact_only_unqualified", { consentStatus: "unknown" }), {
      consentGranted: false,
    });
    expect(p.actions[0]!.kind).toBe("capture_consent");
    expect(p.actions[0]!.templateId).toBe("consent_intro_neutral");
    expect(p.actions[0]!.wouldSend).toBe(false);
    const content = p.actions.find((a) => a.kind === "send_message")!;
    expect(content.blockedReason).toBe("consent_not_granted");
  });

  it("existing consent still blocks content while consent is not recorded", () => {
    const p = plan(input("active_form_enquiry", { consentStatus: "unknown" }), {
      consentGranted: false,
    });
    expect(p.actions.find((a) => a.kind === "send_message")!.blockedReason).toBe(
      "consent_not_granted",
    );
  });
});

describe("neutral language guard", () => {
  it("rejects every history-implying template for neutral contexts", () => {
    for (const t of HISTORY_IMPLYING_TEMPLATES) {
      expect(templateAllowed(t, "contact_only_unqualified")).toBe(false);
      expect(templateAllowed(t, "cold_lead")).toBe(false);
      expect(templateAllowed(t, "manually_added_contact")).toBe(false);
    }
    expect(templateAllowed("consent_intro_neutral", "cold_lead")).toBe(true);
  });

  it("neutral contexts only ever plan neutral templates", () => {
    const p = plan(input("cold_lead", { consentStatus: "unknown" }), { consentGranted: false });
    const templates = p.actions.map((a) => a.templateId).filter(Boolean);
    for (const t of templates) {
      expect(HISTORY_IMPLYING_TEMPLATES).not.toContain(t);
    }
    expect(p.actions.every((a) => a.kind !== "send_message" || a.neutralLanguageRequired)).toBe(true);
  });

  it("history-implying template on a neutral context is blocked, not downgraded", () => {
    const p = planSequenceActions({
      decision: {
        sequence: "historical_booking_link",
        reason: "synthetic",
        certainty: "certain",
        consentRequired: "existing_consent_required",
        handoff: false,
        neutralLanguageRequired: true,
        wouldSend: false,
      },
      facts: facts({ leadContext: "cold_lead" }),
    });
    const blocked = p.actions.find((a) => a.kind === "no_action")!;
    expect(blocked.blockedReason).toBe("owner_review");
    expect(p.actions.some((a) => a.kind === "send_message")).toBe(false);
  });
});

describe("booking offers and cadence", () => {
  it("missing booking link blocks the offer with an explicit reason", () => {
    const p = plan(input("previous_customer"), { hasBookingLink: false });
    const offer = p.actions.find((a) => a.kind === "offer_booking")!;
    expect(offer.blockedReason).toBe("missing_booking_link");
  });

  it("invalid service duration blocks the offer", () => {
    const p = plan(input("previous_customer"), { bookableServiceValid: false });
    expect(p.actions.find((a) => a.kind === "offer_booking")!.blockedReason).toBe("invalid_service");
  });

  it("booking intent uses the fast path and offers slots", () => {
    const p = plan(input("contact_only_unqualified", { explicitBookingIntent: true }));
    expect(p.sequence).toBe("booking_intent_fast_path");
    expect(p.actions.some((a) => a.kind === "offer_booking")).toBe(true);
  });

  it("follow-up offsets are immediate, 5h and 24h", () => {
    expect(FOLLOW_UP_OFFSETS_MINUTES).toEqual([0, 300, 1440]);
    const p = plan(input("active_form_enquiry"));
    expect(p.actions.filter((a) => a.kind === "schedule_follow_up").map((a) => a.offsetMinutes)).toEqual([
      0, 300, 1440,
    ]);
  });

  it("no active follow-up rules is reported, not silently dropped", () => {
    const p = plan(input("active_form_enquiry"), { followUpRuleSteps: [] });
    expect(p.actions.some((a) => a.blockedReason === "no_follow_up_rules")).toBe(true);
  });

  it("quiet hours are reported as a gate reason", () => {
    const p = plan(input("active_form_enquiry"), { quietHoursNow: true });
    expect(p.actions.find((a) => a.kind === "send_message")!.blockedReason).toBe("quiet_hours");
  });
});

describe("tenant scope and idempotency", () => {
  it("throws on tenant mismatch", () => {
    expect(() =>
      planSequenceActions({
        decision: selectSequence(input("active_form_enquiry")),
        facts: facts({ leadBusinessId: "33333333-3333-3333-3333-333333333333" }),
      }),
    ).toThrow(TenantMismatchError);
  });

  it("keys are stable across repeated planning and tenant-distinct", () => {
    const a = plan(input("active_form_enquiry")).actions.map((x) => x.idempotencyKey);
    const b = plan(input("active_form_enquiry")).actions.map((x) => x.idempotencyKey);
    expect(a).toEqual(b);

    const other = planSequenceActions({
      decision: selectSequence(input("active_form_enquiry")),
      facts: facts({
        businessId: "44444444-4444-4444-4444-444444444444",
        leadBusinessId: "44444444-4444-4444-4444-444444444444",
      }),
    }).actions.map((x) => x.idempotencyKey);
    expect(other).not.toEqual(a);
    for (const k of a.filter(Boolean)) expect(k).toContain(BUSINESS);
  });
});

describe("dry-run output for every lead context", () => {
  const contexts: LeadContext[] = [
    "quote_chat_lead",
    "active_form_enquiry",
    "active_conversation",
    "campaign_reply",
    "abandoned_quote",
    "verified_historical_enquiry",
    "previous_customer",
    "contact_only_unqualified",
    "manually_added_contact",
    "cold_lead",
    "booked_lead",
    "owner_review",
  ];

  it.each(contexts)("%s produces a stable, ordered plan", (ctx) => {
    const p = plan(input(ctx, { consentStatus: ctx === "cold_lead" ? "unknown" : "granted" }));
    expect(p.actions.length).toBeGreaterThan(0);
    expect(p.actions.map((a) => a.kind)).toEqual(plan(input(ctx, { consentStatus: ctx === "cold_lead" ? "unknown" : "granted" })).actions.map((a) => a.kind));
    // Consent capture, when present, always precedes any content message.
    const consentIndex = p.actions.findIndex((a) => a.kind === "capture_consent");
    const contentIndex = p.actions.findIndex((a) => a.kind === "send_message");
    if (consentIndex >= 0 && contentIndex >= 0) expect(consentIndex).toBeLessThan(contentIndex);
  });
});
