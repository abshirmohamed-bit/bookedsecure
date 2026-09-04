// Canonical lead booking projection.
//
// The booking tables (`booking_offers`, `jobs`) are authoritative. This module
// is the single description of the lead columns those tables project onto, so
// the database routine, the server code and the UI cannot drift apart.
//
// It is pure: it never reads, writes, sends or books.

export type BookingStatus = "none" | "offered" | "scheduled" | "completed" | "cancelled";

export type LeadBookingProjection = {
  status: string;
  booking_status: BookingStatus;
  customer_status: string;
};

export type LeadBookingState = {
  status: string;
  booking_status: string;
  /** Left untouched by every booking transition; carried through for clarity. */
  quote_status: string;
  customer_status: string;
};

/**
 * Columns written when an offer is confirmed AND its scheduled job exists.
 * `quote_status` is intentionally absent: a booking commit must never overwrite
 * the quote lifecycle with an unrelated value.
 */
export function projectLeadAfterBookingCommit(current: LeadBookingState): LeadBookingProjection {
  return {
    status: "scheduled",
    booking_status: "scheduled",
    // A returning customer stays a previous customer; anyone else is now booked.
    customer_status:
      current.customer_status === "previous_customer" ? "previous_customer" : "booked_lead",
  };
}

/** True when the projection already matches, so a retry needs no write at all. */
export function bookingProjectionUpToDate(current: LeadBookingState): boolean {
  return current.status === "scheduled" && current.booking_status === "scheduled";
}

/**
 * A declined, withdrawn, expired or unavailable slot changes nothing about the
 * lead: the previous declined/available state is preserved verbatim.
 */
export function projectLeadAfterBookingNotCommitted(current: LeadBookingState): LeadBookingState {
  return { ...current };
}

/** Booking state shown in the UI, derived only from the canonical columns. */
export function bookingStateLabel(current: Pick<LeadBookingState, "booking_status">): string {
  switch (current.booking_status) {
    case "scheduled":
      return "Scheduled";
    case "offered":
      return "Slots offered";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Not booked";
  }
}

/** A lead whose booking is live can never enter an outbound reactivation canary. */
export function bookingBlocksReactivation(current: Pick<LeadBookingState, "booking_status">): boolean {
  return current.booking_status === "scheduled" || current.booking_status === "offered";
}
