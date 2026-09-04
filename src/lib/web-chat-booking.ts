// Phase 4 pilot: pure helpers for the public AI chat booking step.
//
// No I/O, no model call. Pilot scope, slot labelling and the customer-facing
// wording all live here so they can be tested without a database.

/** Canonical Glocast tenant identity (verified against the tenant record). */
export const PILOT_BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
export const PILOT_TENANT_SLUG = "glocast";

/**
 * The single pilot service. The tenant's canonical record is named
 * "Full Interior Detail"; the brief calls it "Full Detail". Both normalise to
 * the same pilot service and nothing else qualifies.
 */
export const PILOT_SERVICE_NAMES = ["full detail", "full interior detail"] as const;

export const NO_SLOT_CHOICE = "__none__";

export type PilotOffer = { offer_id: string; slot_start: string; label: string };

function normaliseName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** True only for the one approved pilot service. */
export function isPilotServiceName(name: string | null | undefined): boolean {
  return (PILOT_SERVICE_NAMES as readonly string[]).includes(normaliseName(name));
}

/**
 * Booking eligibility.
 *
 * Under booking-only production mode the tenant may take a booking for ANY of
 * its approved, active services that has a server-side appointment duration —
 * the deterministic availability function still decides the times. Outside
 * booking-only mode the original single-service pilot scope applies. Every
 * other condition must hold in both cases; anything else completes the
 * conversation with no booking step.
 */
export function isPilotEligible(input: {
  businessId: string;
  slug: string;
  approvedServiceId: string | null | undefined;
  serviceName: string | null | undefined;
  serviceActive: boolean;
  /** The approved service's own server-side duration in minutes. */
  serviceDurationMinutes: number | null | undefined;
  availabilityActive: boolean;
  slotCount: number;
  /** True when the tenant is authorised for booking-only production mode. */
  bookingOnlyTenant?: boolean;
}): boolean {
  if (input.businessId !== PILOT_BUSINESS_ID) return false;
  if (input.slug.toLowerCase() !== PILOT_TENANT_SLUG) return false;
  if (!input.approvedServiceId) return false;
  if (!input.serviceActive) return false;
  if (input.bookingOnlyTenant !== true && !isPilotServiceName(input.serviceName)) return false;
  if (
    !Number.isInteger(input.serviceDurationMinutes) ||
    Number(input.serviceDurationMinutes) <= 0
  )
    return false;
  if (!input.availabilityActive) return false;
  return input.slotCount > 0;
}


/** Tenant-local, human-readable slot label. The tenant timezone, never the browser's. */
export function slotLabel(slotStart: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(slotStart))
    .replace(/\u202f/g, " ");
}

/** Deterministic commit key: replaying the same selection can never book twice. */
export function webChatBookingIdempotencyKey(conversationId: string, offerId: string): string {
  return `webchat_booking:${conversationId}:${offerId}`;
}

export const BOOKING_PROMPT_TEXT = "Pick a time that suits. I'll book you in on the spot.";

export const BOOKING_CONFLICT_MESSAGE =
  "Sorry — that time was just taken while we were talking. Here are the times that are still open.";

export const BOOKING_UNAVAILABLE_MESSAGE =
  "Those times have just closed and I can't find another one right now, so I've left your enquiry with the team to arrange a time with you directly.";

export function bookingDeclinedMessage(businessName: string): string {
  return [
    `No problem — nothing is booked.`,
    `${businessName} has your enquiry and will be in touch to arrange a time that works for you.`,
  ].join(" ");
}

export const BOOKING_EXPIRED_MESSAGE =
  "That time had been held for a while and has since expired, so I've refreshed the options. Here are the times that are open right now.";
