// Booking-aware soft deletion policy.
//
// SAFETY BOUNDARY: pure. No IO, no SMS, no provider call, no booking write.
// It only decides, from the AUTHORITATIVE booking tables (`booking_offers`,
// `jobs`) rather than the lead's projection columns, whether a lead is booked,
// what booking projection must be preserved through a soft delete or restore,
// and whether deletion is blocked by product policy.

import {
  bookingBlocksReactivation,
  projectLeadAfterBookingCommit,
  type LeadBookingProjection,
  type LeadBookingState,
} from "@/lib/booking-projection";

/** Offer statuses that mean a live, customer-accepted booking. */
export const LIVE_OFFER_STATUSES = new Set(["confirmed"]);
/** Job completion statuses that mean a live, scheduled appointment. */
export const LIVE_JOB_STATUSES = new Set(["scheduled"]);

export type AuthoritativeOffer = { lead_id: string; status?: string | null };
export type AuthoritativeJob = { lead_id: string; completion_status?: string | null };

export type AuthoritativeBookingState = {
  leadId: string;
  hasConfirmedOffer: boolean;
  hasScheduledJob: boolean;
  /** True when either authoritative record shows a live booking. */
  booked: boolean;
};

/** Reads the authoritative booking tables only. never the lead projection. */
export function authoritativeBookingState(input: {
  leadId: string;
  offers?: readonly AuthoritativeOffer[];
  jobs?: readonly AuthoritativeJob[];
}): AuthoritativeBookingState {
  const hasConfirmedOffer = (input.offers ?? []).some(
    (offer) => offer.lead_id === input.leadId && LIVE_OFFER_STATUSES.has(String(offer.status ?? "")),
  );
  const hasScheduledJob = (input.jobs ?? []).some(
    (job) =>
      job.lead_id === input.leadId && LIVE_JOB_STATUSES.has(String(job.completion_status ?? "")),
  );
  return {
    leadId: input.leadId,
    hasConfirmedOffer,
    hasScheduledJob,
    booked: hasConfirmedOffer || hasScheduledJob,
  };
}

/**
 * Columns a soft delete or restore must write so the lead projection keeps
 * agreeing with the booking tables. Returns `null` when nothing needs writing:
 * an unbooked lead is left exactly as it is, so its normal non-booked state
 * (including `quote_status` and consent, which are never in this set) survives.
 */
export function bookingPreservationColumns(
  current: LeadBookingState,
  authoritative: AuthoritativeBookingState,
): LeadBookingProjection | null {
  if (!authoritative.booked) return null;
  const projected = projectLeadAfterBookingCommit(current);
  return {
    status: projected.status,
    booking_status: projected.booking_status,
    // The existing customer status is preserved as-is by the commit projection.
    customer_status: projected.customer_status,
  };
}

/** The lead columns a deletion or restore is ever allowed to touch. */
export const DELETION_COLUMNS = [
  "deleted_at",
  "deleted_by",
  "deletion_reason",
  "deletion_request_id",
] as const;

/** Columns a deletion or restore must never write. */
export const DELETION_FORBIDDEN_COLUMNS = [
  "quote_status",
  "consent_status",
  "consent_source",
  "consent_record",
  "requires_owner_review",
  "current_sequence",
  "reachability_state",
] as const;

/**
 * Product policy switch. `false` (default) keeps booked leads deletable while
 * preserving their booking projection; `true` refuses them with a clear reason.
 */
export const BLOCK_DELETION_OF_BOOKED_LEADS = false;

export const BOOKED_DELETION_BLOCK_REASON =
  "Has a confirmed booking or scheduled job. cancel the booking before removing the lead";

export function deletionBlockedByBooking(
  authoritative: AuthoritativeBookingState,
  policy: { blockBookedLeads?: boolean } = {},
): boolean {
  const block = policy.blockBookedLeads ?? BLOCK_DELETION_OF_BOOKED_LEADS;
  return block && authoritative.booked;
}

/**
 * Reactivation / outbound SMS execution eligibility. A soft-deleted lead is
 * always blocked, and so is any lead with a live booking.
 */
export function reactivationBlocked(lead: {
  deleted_at?: string | null;
  booking_status?: string | null;
}): boolean {
  if (lead.deleted_at) return true;
  return bookingBlocksReactivation({ booking_status: String(lead.booking_status ?? "none") });
}
