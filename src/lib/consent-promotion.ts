// Consent promotion: the canonical lead consent fields.
//
// Pure and deterministic. Consent is only ever derived from an affirmative
// consent capture on the submission being processed — never from a phone
// number, an email, CRM provenance, a prior enquiry or a lead stage. The
// helpers here decide which columns a capture writes onto the exact lead that
// owns the consent event, and nothing else. They touch no owner-review, no
// lead context, no booking state and no execution control.

export const DEFAULT_CONSENT_TEXT = "Consent given on quote form";

export type ConsentCapture = {
  /** True only when the customer actively accepted the consent statement. */
  consented?: boolean | undefined;
  consentText?: string | null | undefined;
  sourceChannel?: string | null | undefined;
  sourceForm?: string | null | undefined;
  formUrl?: string | null | undefined;
  /** Server timestamp for this capture. Never client supplied. */
  at: string;
};

export type ConsentRecord = {
  consented: true;
  at: string;
  text: string;
  source_channel: string;
  source_form: string | null;
  form_url: string | null;
};

export type ConsentPromotion = {
  consent_record: ConsentRecord | null;
  /** Present only for an affirmative capture. */
  consent_status?: "granted";
  consent_source?: string;
};

/**
 * Columns a capture writes on the lead it belongs to.
 *
 * Applies identically on every branch of the quote flow: listed service,
 * unlisted/recommendation request, owner-review submissions, contact-only
 * submissions, and submissions that create no booking.
 */
export function buildConsentPromotion(input: ConsentCapture): ConsentPromotion {
  if (input.consented !== true) {
    // A declined or absent capture leaves the lead non-granted.
    return { consent_record: null };
  }
  const channel = input.sourceChannel ?? "unknown";
  return {
    consent_record: {
      consented: true,
      at: input.at,
      text: input.consentText ?? DEFAULT_CONSENT_TEXT,
      source_channel: channel,
      source_form: input.sourceForm ?? null,
      form_url: input.formUrl ?? null,
    },
    consent_status: "granted",
    consent_source: channel,
  };
}

export type ExistingLeadConsent = {
  consent_status?: string | null;
  consent_source?: string | null;
  opted_out_at?: string | null;
  sms_suppressed_at?: string | null;
};

/**
 * Idempotent repair for a lead whose stored consent evidence was never
 * promoted onto the canonical fields. Returns an empty patch whenever there is
 * nothing to change, and never overrides an opt-out, suppression, or an
 * already-decided consent status.
 */
export function consentPromotionPatch(
  lead: ExistingLeadConsent,
  capture: ConsentCapture,
): { consent_status?: "granted"; consent_source?: string } {
  if (capture.consented !== true) return {};
  if (lead.opted_out_at || lead.sms_suppressed_at) return {};
  const status = lead.consent_status ?? "unknown";
  if (status !== "unknown") return {};
  return { consent_status: "granted", consent_source: capture.sourceChannel ?? "unknown" };
}
