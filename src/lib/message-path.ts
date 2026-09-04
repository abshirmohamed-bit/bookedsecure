// Quiet-hours policy paths for outbound SMS.
//
// Two — and only two — policy paths exist:
//
//   new_lead_response   a direct, service-related reply to an enquiry the
//                       customer just started in the active quote flow;
//   sequence_follow_up  every other automated outbound, including reactivation,
//                       dormant follow-up, bulk campaigns and nurture.
//
// Quiet hours are NOT disabled globally. `sequence_follow_up` always enforces
// the tenant's configured quiet-hours window and defers to the next permitted
// time. `new_lead_response` may run inside the window only when EVERY condition
// below is satisfied on server-verified facts.
//
// Pure module: no I/O, no provider, no writes.

import { businessLocalHour, isQuietHour } from "@/lib/domain";
import { evaluateQuietHoursGate, type QuietHoursSettings } from "./sms/quiet-hours";
import type { TemplateId } from "./sequence-actions";
import type { SequenceId } from "./sequences";

export const MESSAGE_PATHS = ["new_lead_response", "sequence_follow_up"] as const;
export type MessagePath = (typeof MESSAGE_PATHS)[number];

/**
 * Approved new-lead response templates, with their approved version. Anything
 * outside this allow-list is a sequence follow-up and never quiet-hours exempt.
 */
export const NEW_LEAD_RESPONSE_TEMPLATES: Readonly<Record<string, number>> = {
  quote_chat_completion_step: 1,
  active_enquiry_qualification_step: 1,
  slot_offer: 1,
  booking_confirmation: 1,
  booking_operational_update: 1,
};

/** The only templates an already-booked lead may receive on this path. */
export const BOOKED_LEAD_TEMPLATES: readonly string[] = [
  "booking_confirmation",
  "booking_operational_update",
];

/**
 * Sequences that are promotional / campaign-driven by construction. They can
 * never take the new-lead path, whatever the other facts say.
 */
export const PROMOTIONAL_SEQUENCES: readonly SequenceId[] = [
  "previous_customer_reactivation",
  "historical_booking_link",
  "contact_only_introduction",
  "abandoned_quote_recovery",
];

export type NewLeadResponseFacts = {
  /** The customer started this conversation in the tenant's active quote flow. */
  customerInitiated: boolean;
  quoteFlowActive: boolean;
  /** This message answers that same, current enquiry. */
  directResponseToCurrentEnquiry: boolean;
  /** Consent, and the lead it was captured against. */
  consentGranted: boolean;
  consentLeadId: string | null;
  leadId: string;
  optedOut: boolean;
  suppressed: boolean;
  requiresOwnerReview: boolean;
  humanTakeoverActive: boolean;
  automationPaused: boolean;
  /** Template identity, checked against the approved allow-list. */
  templateId: TemplateId | string | null;
  templateVersion: number;
  /** Content classification, server-decided, never model-inferred. */
  promotional: boolean;
  serviceRelated: boolean;
  /** Booking state. */
  alreadyBooked: boolean;
  /** Control switches. */
  tenantKillSwitchAt: string | null;
  globalKillSwitchAt: string | null;
  /** Send identity. */
  idempotencyKey: string | null;
  sourceAttribution: string | null;
  /** Sequence the message belongs to, used to exclude promotional sequences. */
  sequenceId?: SequenceId | null;
};

export type ConditionFailure = { condition: string; detail: string };

/**
 * Evaluates the thirteen new-lead-response conditions. A single failure means
 * the message is not quiet-hours exempt; it does not by itself permit a send —
 * the activation gates still decide that.
 */
export function evaluateNewLeadResponseExemption(facts: NewLeadResponseFacts): {
  granted: boolean;
  failures: readonly ConditionFailure[];
} {
  const failures: ConditionFailure[] = [];
  const fail = (condition: string, detail: string) => failures.push({ condition, detail });

  if (!facts.customerInitiated || !facts.quoteFlowActive)
    fail("customer_initiated", "conversation was not started by the customer in the active quote flow");
  if (!facts.directResponseToCurrentEnquiry)
    fail("direct_response", "message is not a direct response to the current enquiry");
  if (!facts.consentGranted) fail("consent", "lead does not have explicit SMS consent");
  if (facts.consentLeadId !== facts.leadId)
    fail("consent_identity", "consent does not belong to this exact lead id");
  if (facts.optedOut) fail("opt_out", "lead has opted out");
  if (facts.suppressed) fail("suppression", "lead is suppressed");
  if (facts.requiresOwnerReview) fail("owner_review", "lead requires owner review");
  if (facts.humanTakeoverActive) fail("human_takeover", "a human takeover is active");
  if (facts.automationPaused) fail("automation_paused", "automation is paused for this lead");

  const templateId = facts.templateId ?? "";
  const approvedVersion = NEW_LEAD_RESPONSE_TEMPLATES[templateId];
  if (approvedVersion === undefined)
    fail("approved_template", `template "${templateId || "none"}" is not an approved new-lead response`);
  else if (approvedVersion !== facts.templateVersion)
    fail("approved_template", "template version differs from the approved version");

  if (facts.promotional || !facts.serviceRelated)
    fail("service_related", "message is promotional rather than a service response");
  if (facts.sequenceId && PROMOTIONAL_SEQUENCES.includes(facts.sequenceId))
    fail("service_related", `sequence ${facts.sequenceId} is campaign/reactivation outreach`);

  if (facts.alreadyBooked && !BOOKED_LEAD_TEMPLATES.includes(templateId))
    fail("booking_state", "lead is already booked and this is not a confirmation or operational update");

  if (facts.tenantKillSwitchAt) fail("kill_switch", "tenant kill switch is active");
  if (facts.globalKillSwitchAt) fail("kill_switch", "platform kill switch is active");

  if (!facts.idempotencyKey) fail("idempotency", "send has no idempotency key");
  if (!facts.sourceAttribution) fail("attribution", "send has no source attribution");

  return { granted: failures.length === 0, failures };
}

/** The path a message takes. Only a granted exemption candidate is new-lead. */
export function classifyMessagePath(facts: NewLeadResponseFacts): MessagePath {
  const candidate =
    facts.customerInitiated &&
    facts.quoteFlowActive &&
    facts.directResponseToCurrentEnquiry &&
    NEW_LEAD_RESPONSE_TEMPLATES[facts.templateId ?? ""] !== undefined &&
    !facts.promotional &&
    !(facts.sequenceId ? PROMOTIONAL_SEQUENCES.includes(facts.sequenceId) : false);
  return candidate ? "new_lead_response" : "sequence_follow_up";
}

/** Tenant-local wall-clock time, formatted for the decision report. */
export function localTimeIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

// One-minute resolution, so a deferred send resumes exactly on the boundary
// (08:00 tenant-local) rather than at the next coarse step.
const STEP_MS = 60 * 1000;

/**
 * First instant at or after `at` that falls outside the tenant's quiet-hours
 * window, evaluated in the tenant's timezone (never server UTC). A blocked
 * sequence resumes here rather than being dropped.
 */
export function nextPermittedSendAt(settings: QuietHoursSettings, at: Date): string {
  let cursor = at.getTime();
  const limit = cursor + 48 * 60 * 60 * 1000;
  while (cursor <= limit) {
    const hour = businessLocalHour(settings.timezone, new Date(cursor));
    if (!isQuietHour(hour, settings.quiet_hours_start, settings.quiet_hours_end))
      return new Date(cursor).toISOString();
    cursor += STEP_MS;
  }
  return new Date(cursor).toISOString();
}

export type OutboundDecision = {
  message_path: MessagePath;
  quiet_hours_applied: boolean;
  quiet_hours_reason: string;
  tenant_timezone: string;
  current_local_time: string;
  next_permitted_send_at: string;
  template_id: string | null;
  template_version: number;
  consent_result: "granted" | "missing" | "wrong_lead";
  suppression_result: "clear" | "suppressed" | "opted_out";
  owner_review_result: "clear" | "required";
  human_takeover_result: "clear" | "active";
  booking_result: "none" | "booked_allowed" | "booked_blocked";
  source_attribution: string | null;
  idempotency_key: string | null;
  eligible: boolean;
  wouldSend: boolean;
  exemption_failures: readonly ConditionFailure[];
};

/**
 * The complete outbound decision record. `wouldSend` is advisory only: the
 * activation gates and the executor still decide whether anything runs, and
 * live execution remains disabled.
 */
export function buildOutboundDecision(input: {
  facts: NewLeadResponseFacts;
  quietHours: QuietHoursSettings;
  at: Date;
  /** Gate outcome from `evaluateActivationGates`, quiet hours excluded. */
  otherGatesPassed: boolean;
  /** True when this exact idempotency key has already produced a send. */
  alreadySent?: boolean;
}): OutboundDecision {
  const { facts, quietHours, at } = input;
  const gate = evaluateQuietHoursGate(quietHours, at);
  const path = classifyMessagePath(facts);
  const exemption =
    path === "new_lead_response"
      ? evaluateNewLeadResponseExemption(facts)
      : { granted: false, failures: [{ condition: "path", detail: "sequence follow-up path" }] };

  const insideWindow = gate.blocked;
  const quietHoursApplied = insideWindow && !(path === "new_lead_response" && exemption.granted);

  const reason = !insideWindow
    ? "outside quiet hours"
    : quietHoursApplied
      ? path === "sequence_follow_up"
        ? `sequence follow-up inside quiet hours (${quietHours.quiet_hours_start}:00–${quietHours.quiet_hours_end}:00 ${quietHours.timezone}) — deferred, not dropped`
        : `new-lead response failed exemption conditions: ${exemption.failures
            .map((f) => f.condition)
            .join(", ")}`
      : "approved new-lead response, exempt inside quiet hours";

  const consentResult: OutboundDecision["consent_result"] = !facts.consentGranted
    ? "missing"
    : facts.consentLeadId !== facts.leadId
      ? "wrong_lead"
      : "granted";
  const suppressionResult: OutboundDecision["suppression_result"] = facts.optedOut
    ? "opted_out"
    : facts.suppressed
      ? "suppressed"
      : "clear";
  const bookingResult: OutboundDecision["booking_result"] = !facts.alreadyBooked
    ? "none"
    : BOOKED_LEAD_TEMPLATES.includes(facts.templateId ?? "")
      ? "booked_allowed"
      : "booked_blocked";

  const eligible =
    input.otherGatesPassed &&
    !quietHoursApplied &&
    consentResult === "granted" &&
    suppressionResult === "clear" &&
    !facts.requiresOwnerReview &&
    !facts.humanTakeoverActive &&
    !facts.automationPaused &&
    bookingResult !== "booked_blocked" &&
    Boolean(facts.idempotencyKey) &&
    Boolean(facts.sourceAttribution);

  return {
    message_path: path,
    quiet_hours_applied: quietHoursApplied,
    quiet_hours_reason: reason,
    tenant_timezone: quietHours.timezone,
    current_local_time: localTimeIn(quietHours.timezone, at),
    next_permitted_send_at: quietHoursApplied
      ? nextPermittedSendAt(quietHours, at)
      : at.toISOString(),
    template_id: facts.templateId ?? null,
    template_version: facts.templateVersion,
    consent_result: consentResult,
    suppression_result: suppressionResult,
    owner_review_result: facts.requiresOwnerReview ? "required" : "clear",
    human_takeover_result: facts.humanTakeoverActive ? "active" : "clear",
    booking_result: bookingResult,
    source_attribution: facts.sourceAttribution,
    idempotency_key: facts.idempotencyKey,
    exemption_failures: exemption.failures,
    eligible,
    // A replay of the same idempotency key never produces a second send.
    wouldSend: eligible && input.alreadySent !== true,
  };
}
