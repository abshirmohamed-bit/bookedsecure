// Booking-only production mode (pure policy — no I/O).
//
// This module encodes ONE narrow production capability: a customer can walk the
// deterministic quote → service → server availability → slot selection →
// confirmed booking path, and the tenant's owner is alerted. Nothing else about
// automation is enabled by this mode: no campaigns, no cold introductions, no
// follow-up sequences, no reactivation, no promotional SMS, no AI free-form
// outbound, and no AI authority over prices, discounts, fees or owner settings.

/** Tenants explicitly authorised for booking-only production mode. */
export const BOOKING_ONLY_TENANTS: readonly string[] = [
  "11111111-1111-1111-1111-111111111111", // Glocast
];

export function isBookingOnlyTenant(businessId: string): boolean {
  return BOOKING_ONLY_TENANTS.includes(businessId);
}

/**
 * The only outbound message this mode may ever produce: the server-composed
 * operational booking confirmation, keyed to the confirmed offer.
 */
export const BOOKING_ONLY_ALLOWED_TEMPLATE = "booking_confirmation" as const;

/** Everything explicitly kept disabled by booking-only mode. */
export const BOOKING_ONLY_DISABLED = [
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
] as const;

export type BookingOnlyDisabledCapability = (typeof BOOKING_ONLY_DISABLED)[number];

export function bookingOnlyBlocks(capability: string): boolean {
  return (BOOKING_ONLY_DISABLED as readonly string[]).includes(capability);
}

/** A message may leave this mode only if it is the operational confirmation. */
export function bookingOnlyOutboundAllowed(input: {
  templateId: string | null | undefined;
  hasConfirmedBooking: boolean;
}): boolean {
  return input.hasConfirmedBooking && input.templateId === BOOKING_ONLY_ALLOWED_TEMPLATE;
}

export type ConfirmationSmsFacts = {
  consentStatus: string | null | undefined;
  optedOutAt: string | null | undefined;
  smsSuppressedAt: string | null | undefined;
  mobileNumber: string | null | undefined;
};

export type ConfirmationSmsDecision =
  | { allowed: true }
  | { allowed: false; reason: "consent_missing" | "opted_out" | "suppressed" | "no_number" };

/**
 * Operational confirmation SMS is gated on explicit consent and on STOP /
 * suppression state. It is never promotional and never AI-authored.
 */
export function confirmationSmsDecision(facts: ConfirmationSmsFacts): ConfirmationSmsDecision {
  if (facts.optedOutAt) return { allowed: false, reason: "opted_out" };
  if (facts.smsSuppressedAt) return { allowed: false, reason: "suppressed" };
  if (!facts.mobileNumber) return { allowed: false, reason: "no_number" };
  if (facts.consentStatus !== "granted") return { allowed: false, reason: "consent_missing" };
  return { allowed: true };
}

/** Deterministic, tenant-scoped owner alert for a confirmed booking. */
export function ownerBookingAlert(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  customerName: string | null | undefined;
  serviceName: string | null | undefined;
  slotLabel: string;
}): { kind: string; title: string; body: string; idempotencyKey: string } {
  const name = (input.customerName ?? "").trim() || "A customer";
  const service = (input.serviceName ?? "").trim() || "a detail";
  return {
    kind: "booking_confirmed",
    title: "New confirmed booking",
    body: `${name} booked ${service} for ${input.slotLabel}.`,
    // Tenant + offer scoped: a replay of the same booking never alerts twice.
    idempotencyKey: `booking_confirmed:${input.businessId}:${input.offerId}`,
  };
}

/** Booking-only mode never plans a sequence after a confirmed booking. */
export function bookingOnlyFollowUpSequence(): null {
  return null;
}
