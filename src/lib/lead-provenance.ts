// Phase 1: lead provenance and context classification.
//
// Pure, deterministic, no I/O. This is the single place that decides what the
// system is allowed to believe about a lead. It never infers a previous
// enquiry, service, vehicle, location, quote, booking, consent or discount
// eligibility from sparse contact details: a record with only a name, email
// and phone is `contact_only_unqualified` and nothing more.
//
// The classification mirrors the SQL backfill exactly, so a row classified in
// the database and the same row classified here always agree.

export const LEAD_CONTEXTS = [
  "quote_chat_lead",
  "active_form_enquiry",
  "abandoned_quote",
  "verified_historical_enquiry",
  "previous_customer",
  "manually_added_contact",
  "contact_only_unqualified",
  "active_conversation",
  "campaign_reply",
  "booked_lead",
  "cold_lead",
  "owner_review",
] as const;

export type LeadContext = (typeof LEAD_CONTEXTS)[number];

export type ConsentStatus = "unknown" | "granted" | "declined" | "opted_out" | "suppressed";
export type BookingStatus = "none" | "offered" | "scheduled" | "completed" | "cancelled";
export type CustomerStatus = "unknown" | "prospect" | "previous_customer";

export const CRM_IMPORT_ORIGIN = "crm_import";
export const MANUAL_ORIGIN = "manual";

/** Everything the classifier is allowed to look at. All of it is server data. */
export type ProvenanceInput = {
  lead_origin?: string | null;
  requires_owner_review?: boolean | null;
  /** A real job row, never an assumption drawn from message history. */
  hasCompletedJob?: boolean;
  hasScheduledJob?: boolean;
  /** True only when a web_conversations row exists for this lead. */
  hasQuoteChatConversation?: boolean;
  /**
   * True only when `classifyCompletedQuoteLead` (see quote-classification.ts)
   * confirmed a completed public quote conversation with an approved service,
   * customer, vehicle, suburb and explicit SMS consent, no confirmed booking
   * and no scheduled job. Declining offered slots does NOT clear this flag.
   */
  completedQuoteActiveEnquiry?: boolean;
  /** Verified only when the customer supplied it themselves. */
  approved_service_id?: string | null;
  vehicle_type?: string | null;
  suburb?: string | null;
  main_concerns?: string | null;
  opted_out_at?: string | null;
  sms_suppressed_at?: string | null;
  consent_record?: unknown;
};

export type ProvenanceContext = {
  leadContext: LeadContext;
  bookingStatus: BookingStatus;
  customerStatus: CustomerStatus;
  consentStatus: ConsentStatus;
  verifiedServiceId: string | null;
  verifiedVehicle: string | null;
  verifiedSuburb: string | null;
  verifiedConcern: string | null;
  /** False whenever the record carries no verified enquiry context at all. */
  hasVerifiedContext: boolean;
};

const text = (value: unknown): string | null => {
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0 ? t : null;
};

/** Consent is read from records, never inferred from activity. */
export function deriveConsentStatus(input: ProvenanceInput): ConsentStatus {
  if (input.opted_out_at) return "opted_out";
  if (input.sms_suppressed_at) return "suppressed";
  if (input.consent_record != null) return "granted";
  return "unknown";
}

export function deriveBookingStatus(input: ProvenanceInput): BookingStatus {
  if (input.hasCompletedJob) return "completed";
  if (input.hasScheduledJob) return "scheduled";
  return "none";
}

/** Verified context = fields the customer actually gave us for this record. */
export function deriveVerifiedContext(input: ProvenanceInput) {
  const verifiedServiceId = text(input.approved_service_id);
  const verifiedVehicle = text(input.vehicle_type);
  const verifiedSuburb = text(input.suburb);
  const verifiedConcern = text(input.main_concerns);
  return {
    verifiedServiceId,
    verifiedVehicle,
    verifiedSuburb,
    verifiedConcern,
    hasVerifiedContext: Boolean(
      verifiedServiceId || verifiedVehicle || verifiedSuburb || verifiedConcern,
    ),
  };
}

/**
 * Deterministic classification, most specific first. Order matters and is the
 * same as the migration's CASE expression.
 */
export function classifyLeadContext(input: ProvenanceInput): LeadContext {
  const booking = deriveBookingStatus(input);
  const verified = deriveVerifiedContext(input);

  if (input.requires_owner_review === true) return "owner_review";
  if (booking === "completed") return "previous_customer";
  if (booking === "scheduled") return "booked_lead";
  // A completed public quote conversation is an active enquiry, even when the
  // customer declined every offered slot: declining slots is not evidence of a
  // cold contact.
  if (input.completedQuoteActiveEnquiry === true) return "active_form_enquiry";
  if (input.hasQuoteChatConversation) return "quote_chat_lead";
  if (input.lead_origin === CRM_IMPORT_ORIGIN) {
    return verified.hasVerifiedContext ? "verified_historical_enquiry" : "contact_only_unqualified";
  }
  // A manually typed contact with nothing else known is still contact-only:
  // being in the database is not evidence of an enquiry.
  if (!verified.hasVerifiedContext) return "contact_only_unqualified";
  return "active_form_enquiry";
}

export function deriveProvenance(input: ProvenanceInput): ProvenanceContext {
  const booking = deriveBookingStatus(input);
  const verified = deriveVerifiedContext(input);
  return {
    leadContext: classifyLeadContext(input),
    bookingStatus: booking,
    customerStatus:
      booking === "completed" ? "previous_customer" : booking === "scheduled" ? "prospect" : "unknown",
    consentStatus: deriveConsentStatus(input),
    ...verified,
  };
}

/** Contexts that must never receive history-implying language. */
export const NEUTRAL_ONLY_CONTEXTS: readonly LeadContext[] = [
  "contact_only_unqualified",
  "manually_added_contact",
  "cold_lead",
];

/** True when messaging for this lead must stay neutral about past history. */
export function requiresNeutralLanguage(context: LeadContext): boolean {
  return NEUTRAL_ONLY_CONTEXTS.includes(context);
}

/** True when the record may be described as a genuine past enquiry. */
export function mayReferenceHistory(context: LeadContext): boolean {
  return (
    context === "verified_historical_enquiry" ||
    context === "previous_customer" ||
    context === "abandoned_quote" ||
    context === "quote_chat_lead" ||
    context === "active_form_enquiry"
  );
}
