// Phase 3: the pure booking state and approval contract.
//
// The distinction between a customer reply, a quote, an offered slot and a
// booking is enforced here. A reply or a draft can never reach `scheduled`;
// only an explicitly accepted, still-valid, server-generated slot plus the
// owner's confirmation can.

import { firstName, renderTemplate } from "@/lib/domain";

export type BookingBlockReason =
  | "cross_tenant"
  | "opted_out"
  | "lead_status_blocked"
  | "automation_paused"
  | "availability_inactive"
  | "no_slots_available"
  | "offer_not_found"
  | "no_customer_selection"
  | "offer_expired"
  | "slot_unavailable"
  | "sms_suppressed";

export const BOOKING_BLOCK_LABELS: Record<BookingBlockReason, string> = {
  cross_tenant: "This record belongs to another business.",
  opted_out: "The lead has opted out — nothing can be sent or booked.",
  lead_status_blocked: "The lead status does not allow booking.",
  automation_paused: "Automation is paused for this conversation (owner takeover).",
  availability_inactive: "Bookable availability is switched off in Business settings.",
  no_slots_available: "No valid appointment options are available.",
  offer_not_found: "That appointment option does not exist for this lead.",
  no_customer_selection: "The customer has not explicitly chosen one of the offered times.",
  offer_expired: "That appointment option has expired — offer fresh times.",
  slot_unavailable: "That time is no longer available.",
  sms_suppressed: "Automated SMS is suppressed for this lead.",
};

/** Lead statuses where no booking work may happen. */
export const BOOKING_BLOCKED_STATUSES = ["opted_out", "invalid", "completed", "lost"] as const;

export type BookingLead = {
  id: string;
  business_id: string;
  status: string;
  opted_out_at?: string | null;
  sms_suppressed_at?: string | null;
};

export type BookingConversation = { automation_paused?: boolean | null } | null | undefined;

export type BookingOfferRecord = {
  id: string;
  business_id: string;
  lead_id: string;
  status: string;
  expires_at: string;
  accepted_message_id?: string | null;
  slot_start: string;
};

export type BookingDecision = {
  allowed: boolean;
  reason: BookingBlockReason | null;
  /** Any blocked or unproven booking state stays with the owner. */
  needsHumanReview: boolean;
};

function baseGuards(input: {
  businessId: string;
  lead: BookingLead;
  leadId?: string;
  conversation?: BookingConversation;
}): BookingBlockReason | null {
  if (input.lead.business_id !== input.businessId) return "cross_tenant";
  if (input.lead.opted_out_at) return "opted_out";
  if ((BOOKING_BLOCKED_STATUSES as readonly string[]).includes(input.lead.status))
    return "lead_status_blocked";
  if (input.conversation?.automation_paused === true) return "automation_paused";
  return null;
}

/** Gate for generating and sending server-computed appointment options. */
export function assessOfferGeneration(input: {
  businessId: string;
  lead: BookingLead;
  conversation?: BookingConversation;
  availabilityActive: boolean;
  slotCount: number;
}): BookingDecision {
  const blocked = baseGuards(input);
  if (blocked) return { allowed: false, reason: blocked, needsHumanReview: true };
  if (!input.availabilityActive)
    return { allowed: false, reason: "availability_inactive", needsHumanReview: true };
  if (input.lead.sms_suppressed_at)
    return { allowed: false, reason: "sms_suppressed", needsHumanReview: true };
  if (input.slotCount === 0)
    return { allowed: false, reason: "no_slots_available", needsHumanReview: true };
  return { allowed: true, reason: null, needsHumanReview: false };
}

/**
 * The only path to `scheduled`/Booked.
 *
 * Requires: tenant match, an offer in `accepted` state, recorded evidence of the
 * customer's own explicit selection (an inbound message id), an unexpired
 * offer, and the slot still being available at this exact moment.
 */
export function assessBookingConfirmation(input: {
  businessId: string;
  lead: BookingLead;
  conversation?: BookingConversation;
  offer: BookingOfferRecord | null | undefined;
  slotStillAvailable: boolean;
  now: Date;
}): BookingDecision {
  const blocked = baseGuards(input);
  if (blocked) return { allowed: false, reason: blocked, needsHumanReview: true };

  const offer = input.offer;
  if (!offer) return { allowed: false, reason: "offer_not_found", needsHumanReview: true };
  if (offer.business_id !== input.businessId || offer.lead_id !== input.lead.id)
    return { allowed: false, reason: "cross_tenant", needsHumanReview: true };
  if (offer.status !== "accepted")
    return { allowed: false, reason: "no_customer_selection", needsHumanReview: true };
  if (!offer.accepted_message_id)
    return { allowed: false, reason: "no_customer_selection", needsHumanReview: true };
  if (new Date(offer.expires_at).getTime() <= input.now.getTime())
    return { allowed: false, reason: "offer_expired", needsHumanReview: true };
  if (!input.slotStillAvailable)
    return { allowed: false, reason: "slot_unavailable", needsHumanReview: true };

  return { allowed: true, reason: null, needsHumanReview: false };
}

// ---------------------------------------------------------------------------
// Server-composed message text (never model output)
// ---------------------------------------------------------------------------

export const SLOT_OFFER_TEMPLATE =
  "Hi {{first_name}}, {{business}} can do your {{service}} at: {{options}}. Reply with the time that suits and we'll confirm. Reply STOP to opt out.";

export const BOOKING_CONFIRMATION_TEMPLATE =
  "Hi {{first_name}}, your {{service}} with {{business}} is booked for {{slot}}. We'll be in touch if anything changes. Reply STOP to opt out.";

export function buildSlotOfferMessage(input: {
  name: string;
  businessName: string;
  serviceName: string | null;
  slotLabels: string[];
}): string {
  return renderTemplate(SLOT_OFFER_TEMPLATE, {
    first_name: firstName(input.name),
    business: input.businessName,
    service: input.serviceName ?? "detail",
    options: input.slotLabels.join(" or "),
  });
}

export function buildBookingConfirmationMessage(input: {
  name: string;
  businessName: string;
  serviceName: string | null;
  slotLabel: string;
}): string {
  return renderTemplate(BOOKING_CONFIRMATION_TEMPLATE, {
    first_name: firstName(input.name),
    business: input.businessName,
    service: input.serviceName ?? "detail",
    slot: input.slotLabel,
  });
}

/** Deterministic idempotency keys — a replay never sends or books twice. */
export function slotOfferIdempotencyKey(offerIds: string[]): string {
  return `slot_offer:${[...offerIds].sort().join(",")}`;
}

export function bookingConfirmationIdempotencyKey(offerId: string): string {
  return `booking_confirm:${offerId}`;
}
