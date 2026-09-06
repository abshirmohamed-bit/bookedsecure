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

export const BOOKING_PROMPT_TEXT =
  "Here are the times open right now. Pick one and I'll show it back before anything is locked in.";

/**
 * Deterministic match from typed words to ONE offered slot.
 *
 * Typing must work as well as tapping, but control stays deterministic: the
 * text is only ever mapped onto an offer the server itself generated. Anything
 * that matches zero or more than one offer returns null and the customer is
 * asked again.
 */
function canonicalTokens(value: string): string[] {
  return value
    .toLowerCase()
    // "9am" / "12pm" -> "9 am"
    .replace(/(\d)\s*(am|pm)\b/g, "$1 $2")
    // "9:00" -> "9", "9:30" -> "9 30"
    .replace(/\b(\d{1,2}):00\b/g, "$1")
    .replace(/\b(\d{1,2}):(\d{2})\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => {
      const day = WEEKDAYS.find((name) => name.startsWith(token) && token.length >= 3);
      if (day) return day.slice(0, 3);
      const month = MONTHS.find((name) => name.startsWith(token) && token.length >= 3);
      if (month) return month.slice(0, 3);
      return token.replace(/^0(?=\d)/, "");
    })
    .filter((token) => token.length > 0);
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function matchOfferByText(text: string, offers: readonly PilotOffer[]): PilotOffer | null {
  const said = text.toLowerCase().trim();
  if (!said || offers.length === 0) return null;

  // "the first one", "option 2", "3"
  const ordinal = said.match(/\b(?:option\s*)?(first|1st|1|second|2nd|2|third|3rd|3|fourth|4th|4|last)\b/);
  if (ordinal && !/\b(am|pm)\b/.test(said)) {
    const word = ordinal[1]!;
    const index =
      word === "last"
        ? offers.length - 1
        : ["first", "1st", "1"].includes(word)
          ? 0
          : ["second", "2nd", "2"].includes(word)
            ? 1
            : ["third", "3rd", "3"].includes(word)
              ? 2
              : 3;
    if (said.split(/\s+/).length <= 4 && index >= 0 && index < offers.length) return offers[index]!;
  }

  // Otherwise every distinguishing token the customer said (weekday, day
  // number, month, time) must appear in exactly one offer label.
  const tokens = canonicalTokens(said).filter((token) => !STOP_WORDS.has(token));
  if (tokens.length === 0) return null;
  const matches = offers.filter((offer) => {
    const label = canonicalTokens(offer.label);
    return tokens.every((token) => label.includes(token));
  });
  return matches.length === 1 ? matches[0]! : null;
}


const STOP_WORDS = new Set([
  "the", "a", "at", "on", "in", "for", "please", "pls", "thanks", "ok", "okay", "yes", "yeah",
  "lets", "let", "s", "do", "book", "me", "i", "ll", "will", "take", "that", "one", "time",
  "slot", "works", "work", "suits", "suit", "good", "fine", "can", "we", "you", "my",
]);


/** Explicit final-confirmation choices for the held slot. */
export const BOOKING_CONFIRM_CHOICE = "__confirm__";
export const BOOKING_CHANGE_CHOICE = "__change__";

/**
 * Final summary shown before ANY booking is created. Nothing is written to the
 * calendar until the customer confirms this back.
 */
export function bookingConfirmMessage(input: {
  businessName: string;
  serviceName: string | null | undefined;
  suburb: string | null | undefined;
  vehicle: string | null | undefined;
  slotLabel: string;
}): string {
  const lines = [
    `Service: ${(input.serviceName ?? "").trim() || "as discussed"}`,
    `Time: ${input.slotLabel}`,
  ];
  const vehicle = (input.vehicle ?? "").trim();
  if (vehicle) lines.push(`Vehicle: ${vehicle}`);
  const suburb = (input.suburb ?? "").trim();
  if (suburb) lines.push(`Suburb: ${suburb}`);
  return [
    `Before I lock anything in, here's the booking with ${input.businessName}:`,
    ...lines,
    "Shall I confirm this?",
  ].join("\n");
}

export const BOOKING_CHANGE_MESSAGE =
  "No problem — nothing has been booked. Here are the times that are open right now.";

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
