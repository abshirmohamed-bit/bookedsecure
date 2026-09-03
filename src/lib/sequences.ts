// Phase 2: deterministic sequence-selection engine.
//
// Pure, no I/O, no side effects. Given server-known lead state it returns which
// sequence *would* be selected, why, how certain that decision is, what consent
// is required before anything could be sent, and whether the lead must be
// handed to a human instead.
//
// This module never enrols a lead, never sends, never schedules and never
// writes `current_sequence`. Callers in later phases decide what to do with the
// decision; nothing here has live effects.

import type { BookingStatus, ConsentStatus, LeadContext } from "./lead-provenance";
import { requiresNeutralLanguage } from "./lead-provenance";

export const SEQUENCES = [
  "none",
  "quote_chat_completion",
  "active_enquiry_qualification",
  "abandoned_quote_recovery",
  "historical_booking_link",
  "previous_customer_reactivation",
  "contact_only_introduction",
  "booking_intent_fast_path",
  "booking_confirmation_followup",
  "human_handoff",
] as const;

export type SequenceId = (typeof SEQUENCES)[number];

/** How sure the engine is that the selected sequence is correct. */
export type Certainty = "certain" | "probable" | "insufficient_context";

/** What must be true about consent before this sequence could ever send. */
export type ConsentRequirement =
  | "none_no_outbound"
  | "existing_consent_required"
  | "consent_capture_required"
  | "blocked";

export type SequenceDecisionInput = {
  leadContext: LeadContext;
  consentStatus: ConsentStatus;
  bookingStatus: BookingStatus;
  /** Server-observed explicit intents. Never model-inferred. */
  explicitBookingIntent?: boolean;
  requestedHuman?: boolean;
  requestedQuote?: boolean;
  unsupportedRequest?: boolean;
  conflictingContext?: boolean;
  toolFailure?: boolean;
  /** Control state. */
  tenantTakeover?: boolean;
  automationPaused?: boolean;
  agentEnabled?: boolean;
  /** True once the customer has replied at least once on this conversation. */
  hasInboundReply?: boolean;
  /** True when a public booking link exists for the tenant. */
  hasBookingLink?: boolean;
};

export type SequenceDecision = {
  sequence: SequenceId;
  reason: string;
  certainty: Certainty;
  consentRequired: ConsentRequirement;
  handoff: boolean;
  /** Messaging must not imply any prior enquiry, quote, booking or discount. */
  neutralLanguageRequired: boolean;
  /** Always false in this phase: this engine can never cause a send. */
  wouldSend: false;
};

const decide = (
  sequence: SequenceId,
  reason: string,
  certainty: Certainty,
  consentRequired: ConsentRequirement,
  handoff: boolean,
  leadContext: LeadContext,
): SequenceDecision => ({
  sequence,
  reason,
  certainty,
  consentRequired,
  handoff,
  neutralLanguageRequired: requiresNeutralLanguage(leadContext),
  wouldSend: false,
});

/**
 * Deterministic precedence. Order is the contract; the first matching rule wins.
 * Stops and handoffs are evaluated before any messaging sequence.
 */
export function selectSequence(input: SequenceDecisionInput): SequenceDecision {
  const ctx = input.leadContext;
  const d = (
    s: SequenceId,
    reason: string,
    certainty: Certainty,
    consent: ConsentRequirement,
    handoff = false,
  ) => decide(s, reason, certainty, consent, handoff, ctx);

  // 1-6: hard stops. Nothing may be selected for sending.
  if (input.consentStatus === "opted_out")
    return d("none", "Lead has opted out (STOP)", "certain", "blocked");
  if (input.consentStatus === "suppressed")
    return d("none", "Number is suppressed after delivery failure", "certain", "blocked");
  if (input.consentStatus === "declined")
    return d("none", "Consent was explicitly declined", "certain", "blocked");
  if (input.tenantTakeover)
    return d("human_handoff", "Tenant has taken over this conversation", "certain", "none_no_outbound", true);
  if (input.automationPaused)
    return d("none", "Automation is paused for this lead or tenant", "certain", "none_no_outbound");
  if (input.agentEnabled === false)
    return d("none", "Agent is not enabled for this tenant", "certain", "none_no_outbound");

  // 7-11: explicit escalations take precedence over any messaging sequence.
  if (input.requestedHuman)
    return d("human_handoff", "Customer asked for a human", "certain", "none_no_outbound", true);
  if (input.unsupportedRequest)
    return d("human_handoff", "Request is outside supported services", "certain", "none_no_outbound", true);
  if (input.toolFailure)
    return d("human_handoff", "Tool or provider failure — automation stops", "certain", "none_no_outbound", true);
  if (input.conflictingContext || ctx === "owner_review")
    return d("human_handoff", "Conflicting or unverified context needs owner review", "certain", "none_no_outbound", true);
  if (input.requestedQuote && ctx === "contact_only_unqualified")
    return d(
      "human_handoff",
      "Quote requested with no verified context to quote against",
      "probable",
      "none_no_outbound",
      true,
    );

  // 12: explicit booking intent always short-circuits qualification.
  if (input.explicitBookingIntent) {
    return input.hasBookingLink === false
      ? d("human_handoff", "Booking intent but no tenant booking link configured", "certain", "none_no_outbound", true)
      : d(
          "booking_intent_fast_path",
          "Explicit booking intent — send current booking link and stop qualification",
          "certain",
          input.consentStatus === "granted" ? "existing_consent_required" : "consent_capture_required",
        );
  }

  // 13: booking lifecycle.
  if (input.bookingStatus === "scheduled" || ctx === "booked_lead")
    return d(
      "booking_confirmation_followup",
      "Booking already scheduled — confirmation follow-up only",
      "certain",
      "existing_consent_required",
    );

  // 14: context-driven selection.
  switch (ctx) {
    case "quote_chat_lead":
      return d("quote_chat_completion", "Quote chat in progress — collect only missing fields", "certain", "existing_consent_required");
    case "active_form_enquiry":
    case "campaign_reply":
    case "active_conversation":
      return d(
        "active_enquiry_qualification",
        input.hasInboundReply ? "Live enquiry with a reply — continue toward booking" : "Live enquiry — qualify toward booking",
        "certain",
        "existing_consent_required",
      );
    case "abandoned_quote":
      return d("abandoned_quote_recovery", "Quote started but not completed", "certain", "existing_consent_required");
    case "verified_historical_enquiry":
      return input.hasBookingLink === false
        ? d("human_handoff", "Historical enquiry but no booking link configured", "certain", "none_no_outbound", true)
        : d("historical_booking_link", "Verified previous enquiry — send current booking link, no re-qualification", "certain", "existing_consent_required");
    case "previous_customer":
      return d("previous_customer_reactivation", "Completed job on record — reactivation with booking link", "certain", "existing_consent_required");
    case "contact_only_unqualified":
    case "manually_added_contact":
    case "cold_lead":
      return d(
        "contact_only_introduction",
        "Only name, email and phone are known — neutral introduction, no implied history",
        "certain",
        "consent_capture_required",
      );
    default:
      return d("none", "No sequence matches the known context", "insufficient_context", "none_no_outbound");
  }
}

/** Evaluate a batch of synthetic cases. Pure; returns decisions only. */
export function evaluateSequences(
  cases: readonly SequenceDecisionInput[],
): readonly (SequenceDecisionInput & { decision: SequenceDecision })[] {
  return cases.map((c) => ({ ...c, decision: selectSequence(c) }));
}
