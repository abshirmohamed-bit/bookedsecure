// Phase 3: deterministic sequence *action planning* — dry-run only.
//
// Pure. No I/O, no sends, no writes, no scheduling, no provider calls, no
// enrolment, and no `current_sequence` mutation. Given a Phase 2
// `SequenceDecision` plus server-known facts, this module returns the ordered
// action plan that *would* be executed once activation is explicitly approved
// in a later phase.
//
// Invariants enforced here (asserted by tests):
//  - every action carries `wouldSend: false`;
//  - `capture_consent` is representable but never produces a send;
//  - `booking_confirm` is NEVER emitted — booking confirmation stays owned by
//    the existing idempotent `commitWebChatBooking` path;
//  - `booking_confirmation_followup` plans nothing at all;
//  - `handoff` is planned only; it does not notify or audit here;
//  - blocked actions are returned with an explicit gate reason, never dropped.

import type { LeadContext } from "./lead-provenance";
import { requiresNeutralLanguage } from "./lead-provenance";
import type { SequenceDecision, SequenceId } from "./sequences";

export const PLAN_MODE = "dry_run" as const;

export const ACTION_KINDS = [
  "capture_consent",
  "send_message",
  "schedule_follow_up",
  "offer_booking",
  "handoff",
  "record_audit",
  "no_action",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const BLOCK_REASONS = [
  "consent_not_granted",
  "consent_declined",
  "opted_out",
  "suppressed",
  "quiet_hours",
  "tenant_takeover",
  "automation_paused",
  "agent_disabled",
  "invalid_service",
  "missing_booking_link",
  "tenant_mismatch",
  "tool_failure",
  "no_follow_up_rules",
  "post_booking_state",
  "owner_review",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

/** Templates allowed on automated paths. No model ever generates customer text. */
export const TEMPLATE_IDS = [
  "consent_intro_neutral",
  "quote_chat_completion_step",
  "active_enquiry_qualification_step",
  "abandoned_quote_recovery_step",
  "historical_booking_link",
  "previous_customer_reactivation",
  "contact_only_introduction_neutral",
  "booking_intent_fast_path_link",
  "slot_offer",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Templates that imply prior enquiry/quote/booking/discount/intent. */
export const HISTORY_IMPLYING_TEMPLATES: readonly TemplateId[] = [
  "quote_chat_completion_step",
  "active_enquiry_qualification_step",
  "abandoned_quote_recovery_step",
  "historical_booking_link",
  "previous_customer_reactivation",
];

/** Conservative cadence, in minutes from enrolment. */
export const FOLLOW_UP_OFFSETS_MINUTES = [0, 300, 1440] as const;

export type PlannedAction = {
  kind: ActionKind;
  /** Target tool that *would* be called at activation. Recorded, never invoked. */
  tool:
    | "sendSms"
    | "conversations.next_follow_up_at"
    | "generateBookingOffers+sendSlotOffer"
    | "owner_notification"
    | "agent_actions.insert"
    | "none";
  templateId: TemplateId | null;
  /** Minutes from enrolment; null for non-timed actions. */
  offsetMinutes: number | null;
  idempotencyKey: string | null;
  preconditions: readonly string[];
  eligible: boolean;
  blockedReason: BlockReason | null;
  neutralLanguageRequired: boolean;
  /** Always false in Phase 3. */
  wouldSend: false;
};

export type SequencePlan = {
  mode: typeof PLAN_MODE;
  businessId: string;
  leadId: string;
  sequence: SequenceId;
  decision: SequenceDecision;
  actions: readonly PlannedAction[];
  /** Gate reasons that suppressed the whole plan. */
  blockedReasons: readonly BlockReason[];
  wouldSend: false;
};

export type PlanFacts = {
  businessId: string;
  leadId: string;
  /** business_id on the lead row; must match `businessId`. */
  leadBusinessId: string;
  leadContext: LeadContext;
  /** Server-loaded tenant state. */
  quietHoursNow?: boolean;
  hasBookingLink?: boolean;
  bookableServiceValid?: boolean;
  followUpRuleSteps?: readonly number[];
  consentGranted?: boolean;
  tenantTakeover?: boolean;
  automationPaused?: boolean;
  agentEnabled?: boolean;
  toolFailure?: boolean;
  suppressed?: boolean;
  optedOut?: boolean;
};

export class TenantMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Tenant mismatch: plan scoped to ${expected} but lead belongs to ${actual}`);
    this.name = "TenantMismatchError";
  }
}

const key = (facts: PlanFacts, sequence: SequenceId, suffix: string) =>
  `seq:${facts.businessId}:${facts.leadId}:${sequence}:${suffix}`;

const action = (a: Omit<PlannedAction, "wouldSend">): PlannedAction => ({ ...a, wouldSend: false });

const noAction = (reason: BlockReason | null, note: string): PlannedAction =>
  action({
    kind: "no_action",
    tool: "none",
    templateId: null,
    offsetMinutes: null,
    idempotencyKey: null,
    preconditions: [note],
    eligible: false,
    blockedReason: reason,
    neutralLanguageRequired: false,
  });

/** Content template per messaging sequence. Neutral sequences use neutral copy. */
const CONTENT_TEMPLATE: Partial<Record<SequenceId, TemplateId>> = {
  quote_chat_completion: "quote_chat_completion_step",
  active_enquiry_qualification: "active_enquiry_qualification_step",
  abandoned_quote_recovery: "abandoned_quote_recovery_step",
  historical_booking_link: "historical_booking_link",
  previous_customer_reactivation: "previous_customer_reactivation",
  contact_only_introduction: "contact_only_introduction_neutral",
  booking_intent_fast_path: "booking_intent_fast_path_link",
};

/** Sequences that would offer bookable slots rather than only messaging. */
const OFFERS_BOOKING: readonly SequenceId[] = [
  "booking_intent_fast_path",
  "historical_booking_link",
  "previous_customer_reactivation",
];

export function templateAllowed(templateId: TemplateId, leadContext: LeadContext): boolean {
  if (!requiresNeutralLanguage(leadContext)) return true;
  return !HISTORY_IMPLYING_TEMPLATES.includes(templateId);
}

/**
 * Build the dry-run action plan. Pure; never sends, writes or schedules.
 */
export function planSequenceActions(input: {
  decision: SequenceDecision;
  facts: PlanFacts;
}): SequencePlan {
  const { decision, facts } = input;
  if (facts.businessId !== facts.leadBusinessId) {
    throw new TenantMismatchError(facts.businessId, facts.leadBusinessId);
  }

  const sequence = decision.sequence;
  const neutral = requiresNeutralLanguage(facts.leadContext);
  const blockedReasons: BlockReason[] = [];

  const base = (actions: readonly PlannedAction[]): SequencePlan => ({
    mode: PLAN_MODE,
    businessId: facts.businessId,
    leadId: facts.leadId,
    sequence,
    decision,
    actions,
    blockedReasons,
    wouldSend: false,
  });

  // --- Hard stops: a takeover or stop zeroes the plan entirely. ---
  if (facts.optedOut || decision.consentRequired === "blocked") {
    blockedReasons.push(
      facts.optedOut ? "opted_out" : facts.suppressed ? "suppressed" : "consent_declined",
    );
    return base([noAction(blockedReasons[0]!, "Hard stop: no automated action may be planned.")]);
  }
  if (facts.suppressed) {
    blockedReasons.push("suppressed");
    return base([noAction("suppressed", "Number suppressed after delivery failure.")]);
  }
  if (facts.tenantTakeover) {
    blockedReasons.push("tenant_takeover");
    return base([noAction("tenant_takeover", "Tenant takeover pauses all automated actions.")]);
  }
  if (facts.automationPaused) {
    blockedReasons.push("automation_paused");
    return base([noAction("automation_paused", "Automation paused for this lead or tenant.")]);
  }
  if (facts.agentEnabled === false) {
    blockedReasons.push("agent_disabled");
    return base([noAction("agent_disabled", "Agent not enabled for this tenant.")]);
  }
  if (facts.toolFailure) {
    blockedReasons.push("tool_failure");
  }

  // --- Handoff: planned only. No live notification, no audit write in Phase 3. ---
  if (decision.handoff || sequence === "human_handoff") {
    return base([
      action({
        kind: "handoff",
        tool: "owner_notification",
        templateId: null,
        offsetMinutes: 0,
        idempotencyKey: key(facts, sequence, "handoff"),
        preconditions: [
          "Owner notification only; never a customer message.",
          "Planned in Phase 3; no notification row and no audit record are written.",
        ],
        eligible: false,
        blockedReason: facts.toolFailure ? "tool_failure" : "owner_review",
        neutralLanguageRequired: neutral,
      }),
    ]);
  }

  // --- Post-booking state: plans nothing at all. ---
  if (sequence === "booking_confirmation_followup") {
    blockedReasons.push("post_booking_state");
    return base([
      noAction(
        "post_booking_state",
        "Post-booking state only: no message, offer, schedule, handoff or booking action. The single confirmation SMS is owned by the server-confirmed commitWebChatBooking path.",
      ),
    ]);
  }

  if (sequence === "none") {
    return base([noAction(null, "No sequence selected; nothing to plan.")]);
  }

  const actions: PlannedAction[] = [];

  // --- Consent capture (representable, never a send in Phase 3). ---
  if (decision.consentRequired === "consent_capture_required") {
    actions.push(
      action({
        kind: "capture_consent",
        tool: "sendSms",
        templateId: "consent_intro_neutral",
        offsetMinutes: 0,
        idempotencyKey: key(facts, sequence, "consent"),
        preconditions: [
          "Neutral consent language; implies no prior enquiry, quote, booking or discount.",
          "No content message may be planned before the customer replies.",
          "Phase 3 plans only: sendSms is not called and no outbound message row is created.",
        ],
        eligible: false,
        blockedReason: "consent_not_granted",
        neutralLanguageRequired: true,
      }),
    );
  }

  const templateId = CONTENT_TEMPLATE[sequence] ?? null;
  const consentSatisfied =
    decision.consentRequired === "existing_consent_required" ? facts.consentGranted === true : false;

  if (templateId) {
    if (!templateAllowed(templateId, facts.leadContext)) {
      // Neutral-language guard: never silently downgrade to a history-implying
      // template — the content action is planned as blocked instead.
      actions.push(noAction("owner_review", `Template ${templateId} implies unverified history.`));
    } else {
      const contentBlocked: BlockReason | null = !consentSatisfied
        ? "consent_not_granted"
        : facts.quietHoursNow
          ? "quiet_hours"
          : facts.toolFailure
            ? "tool_failure"
            : null;
      actions.push(
        action({
          kind: "send_message",
          tool: "sendSms",
          templateId,
          offsetMinutes: 0,
          idempotencyKey: key(facts, sequence, "step1"),
          preconditions: [
            "Consent recorded, not opted out, not suppressed, outside quiet hours.",
            "Substitution limited to server-verified values only.",
            "Phase 3 plans only: no provider call and no message row.",
          ],
          eligible: false,
          blockedReason: contentBlocked ?? "consent_not_granted",
          neutralLanguageRequired: neutral,
        }),
      );
    }
  }

  // --- Booking offer (slots), only where a link/service exists. ---
  if (OFFERS_BOOKING.includes(sequence)) {
    const blocked: BlockReason =
      facts.hasBookingLink === false
        ? "missing_booking_link"
        : facts.bookableServiceValid === false
          ? "invalid_service"
          : "consent_not_granted";
    actions.push(
      action({
        kind: "offer_booking",
        tool: "generateBookingOffers+sendSlotOffer",
        templateId: "slot_offer",
        offsetMinutes: 0,
        idempotencyKey: key(facts, sequence, "offer"),
        preconditions: [
          "Server-generated slots only; duration comes from services.duration_minutes.",
          "Client never supplies duration, slot or service.",
          "Booking confirmation is NOT planned here: it stays owned by commitWebChatBooking.",
        ],
        eligible: false,
        blockedReason: blocked,
        neutralLanguageRequired: neutral,
      }),
    );
  }

  // --- Conservative follow-up cadence: immediate, 4-6h, 24h. ---
  const steps = facts.followUpRuleSteps ?? [1, 2, 3];
  if (steps.length === 0) {
    actions.push(noAction("no_follow_up_rules", "No active follow-up rules configured."));
  } else {
    FOLLOW_UP_OFFSETS_MINUTES.forEach((offset, index) => {
      if (index >= steps.length) return;
      actions.push(
        action({
          kind: "schedule_follow_up",
          tool: "conversations.next_follow_up_at",
          templateId,
          offsetMinutes: offset,
          idempotencyKey: key(facts, sequence, `step${steps[index]}`),
          preconditions: [
            "Quiet hours deferral applies at execution time.",
            "Phase 3 plans only: no timer is written and no job is enqueued.",
          ],
          eligible: false,
          blockedReason: facts.quietHoursNow ? "quiet_hours" : "consent_not_granted",
          neutralLanguageRequired: neutral,
        }),
      );
    });
  }

  // --- Audit: planned representation only; nothing is inserted in Phase 3. ---
  actions.push(
    action({
      kind: "record_audit",
      tool: "agent_actions.insert",
      templateId: null,
      offsetMinutes: 0,
      idempotencyKey: key(facts, sequence, "audit"),
      preconditions: [
        "Tenant-scoped (business_id, lead_id, sequence, action, idempotency key).",
        "Planned only in Phase 3; no agent_actions row is written.",
      ],
      eligible: false,
      blockedReason: null,
      neutralLanguageRequired: false,
    }),
  );

  return base(actions);
}

/** Batch dry-run evaluation. Pure. */
export function evaluatePlans(
  cases: readonly { decision: SequenceDecision; facts: PlanFacts }[],
): readonly SequencePlan[] {
  return cases.map(planSequenceActions);
}
