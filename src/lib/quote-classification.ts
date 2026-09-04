// Post-quote-conversation lead classification.
//
// Pure, deterministic, no I/O, no writes, no sends. A lead that completed the
// public quote conversation (`/quote/<slug>` or `ai_chat:<slug>`) with an
// approved service, contact, vehicle, suburb and explicit SMS consent is an
// ACTIVE ENQUIRY — even when the customer declined every offered slot or no
// suitable slot was selected. Declining slots is not evidence of a cold
// contact, so such a lead must never be classified `contact_only_unqualified`
// nor put on `contact_only_introduction`.
//
// This module decides classification only. It does not modify consent, owner
// review, booking state, caps, campaign authorisation or automation settings,
// and it can never cause a send, an agent action or a provider call.

import type { LeadContext } from "./lead-provenance";
import type { SequenceId } from "./sequences";
import type { TemplateId } from "./sequence-actions";
import { NEW_LEAD_RESPONSE_TEMPLATES } from "./message-path";

/** Public quote-flow sources that can produce an active enquiry. */
export const PUBLIC_QUOTE_FORM_PREFIX = "ai_chat:";
export const PUBLIC_QUOTE_PATH_PREFIX = "/quote/";

export type CompletedQuoteFacts = {
  /** `leads.source_form` (e.g. `ai_chat:glocast`) and/or the form URL. */
  sourceForm?: string | null;
  formUrl?: string | null;
  /** A `web_conversations` row for this lead with `completed_at` set. */
  quoteConversationCompleted: boolean;
  /** The conversation row has not been deleted. */
  conversationDeleted?: boolean;
  /** Allow-listed service the customer selected. */
  approvedServiceId?: string | null;
  /** Details captured verbatim from the customer. */
  customerName?: string | null;
  customerContact?: string | null;
  vehicle?: string | null;
  suburb?: string | null;
  /** Explicit SMS consent, captured on this exact lead. */
  consentStatus?: string | null;
  /** Authoritative booking state, read from offers/jobs — never a projection. */
  hasConfirmedBooking?: boolean;
  hasScheduledJob?: boolean;
  /** Customer declined offered slots, or picked none. */
  declinedAllSlots?: boolean;
  noSuitableSlotSelected?: boolean;
  /** Lead soft-delete state. */
  leadDeleted?: boolean;
};

const present = (value: unknown): boolean =>
  typeof value === "string" ? value.trim().length > 0 : false;

/** True when the lead came through the public quote conversation flow. */
export function isPublicQuoteFlowLead(facts: CompletedQuoteFacts): boolean {
  const form = facts.sourceForm ?? "";
  const url = facts.formUrl ?? "";
  return form.startsWith(PUBLIC_QUOTE_FORM_PREFIX) || url.includes(PUBLIC_QUOTE_PATH_PREFIX);
}

export type QuoteClassification = {
  activeEnquiry: boolean;
  leadContext: LeadContext | null;
  sequence: SequenceId | null;
  templateId: TemplateId | null;
  /** Every condition that was not satisfied; empty when `activeEnquiry`. */
  missing: readonly string[];
};

/**
 * Classify a completed public quote conversation. Returns `activeEnquiry` only
 * when every required condition holds on server-verified facts.
 */
export function classifyCompletedQuoteLead(facts: CompletedQuoteFacts): QuoteClassification {
  const missing: string[] = [];
  if (!isPublicQuoteFlowLead(facts)) missing.push("public_quote_flow_source");
  if (!facts.quoteConversationCompleted) missing.push("completed_quote_conversation");
  if (facts.conversationDeleted) missing.push("conversation_not_deleted");
  if (facts.leadDeleted) missing.push("lead_not_deleted");
  if (!present(facts.approvedServiceId)) missing.push("approved_service");
  if (!present(facts.customerName) || !present(facts.customerContact))
    missing.push("customer_details");
  if (!present(facts.vehicle)) missing.push("vehicle_details");
  if (!present(facts.suburb)) missing.push("suburb");
  if (facts.consentStatus !== "granted") missing.push("sms_consent_granted");
  if (facts.hasConfirmedBooking) missing.push("no_confirmed_booking");
  if (facts.hasScheduledJob) missing.push("no_scheduled_job");

  if (missing.length > 0)
    return { activeEnquiry: false, leadContext: null, sequence: null, templateId: null, missing };

  return {
    activeEnquiry: true,
    leadContext: "active_form_enquiry",
    sequence: "active_enquiry_qualification",
    templateId: "active_enquiry_qualification_step",
    missing: [],
  };
}

/**
 * The approved new-lead template for an active enquiry response. Returns null
 * when the template is not on the approved new-lead allow-list, so an
 * unapproved template can never take the `new_lead_response` path.
 */
export function activeEnquiryTemplate(): { templateId: TemplateId; templateVersion: number } | null {
  const templateId: TemplateId = "active_enquiry_qualification_step";
  const version = NEW_LEAD_RESPONSE_TEMPLATES[templateId];
  return version === undefined ? null : { templateId, templateVersion: version };
}
