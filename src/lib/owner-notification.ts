// Tenant owner booking-confirmation notification — pure policy, no I/O.
//
// This is an internal operational alert to the business owner after an
// authoritative booking commit. It is never a campaign, follow-up,
// reactivation, promotional message or AI-authored copy, and it never replaces
// the dashboard booking-confirmed alert.

import { firstName, renderTemplate } from "@/lib/domain";
import { normaliseOwnerNotificationNumber } from "@/lib/owner-phone";
import { formatConfirmationDateTime } from "@/lib/booking-confirmation";

/** Versioned, fixed-field owner template. */
export const OWNER_BOOKING_CONFIRMED_TEMPLATE_ID = "owner_booking_confirmed.v1" as const;

export const OWNER_BOOKING_CONFIRMED_TEMPLATE_V1 =
  "{{tenant_name}} booking confirmed: {{service}} for {{customer_name}} in {{suburb}} on {{date}} at {{time}}. Check the dashboard for full details.";

/** Owner notification idempotency key — one per confirmed booking. */
export function ownerBookingConfirmationIdempotencyKey(bookingId: string): string {
  return `tenant_owner_booking_confirmation:${bookingId}`;
}

export type OwnerNotificationOutcome =
  | "eligible"
  | "sent"
  | "failed"
  | "duplicate_suppressed"
  | "blocked_no_booking"
  | "blocked_cancelled"
  | "blocked_no_owner_number"
  | "blocked_invalid_owner_number";

export type OwnerNotificationFacts = {
  /** Authoritative booking state, read from committed records. */
  offerStatus: string | null | undefined;
  jobId: string | null | undefined;
  /** The tenant's own stored owner notification number. */
  ownerNotificationNumber: string | null | undefined;
};

export type OwnerNotificationDecision = {
  outcome: OwnerNotificationOutcome;
  sendable: boolean;
  reason: string;
};

/** The tenant's stored owner notification number, validated. No default. */
export function resolveOwnerNotificationNumber(
  business: { owner_notification_number?: string | null } | null | undefined,
): string | null {
  const raw = (business?.owner_notification_number ?? "").trim();
  if (!raw) return null;
  // Mobile only: a landline cannot receive the owner alert.
  return normaliseOwnerNotificationNumber(raw);
}

/**
 * Owner alert is allowed only for a committed booking (confirmed offer + job)
 * and only when this tenant has stored a valid owner notification number.
 */
export function evaluateOwnerNotificationEligibility(
  facts: OwnerNotificationFacts,
): OwnerNotificationDecision {
  if (facts.offerStatus !== "confirmed" || !facts.jobId) {
    const cancelled = facts.offerStatus === "withdrawn" || facts.offerStatus === "expired";
    return {
      outcome: cancelled ? "blocked_cancelled" : "blocked_no_booking",
      sendable: false,
      reason: cancelled
        ? "The booking was cancelled — no owner notification was sent."
        : "No committed booking and job exist — no owner notification was sent.",
    };
  }
  const raw = (facts.ownerNotificationNumber ?? "").trim();
  if (!raw) {
    return {
      outcome: "blocked_no_owner_number",
      sendable: false,
      reason: "This business has no owner notification number stored.",
    };
  }
  if (!normaliseOwnerNotificationNumber(raw)) {
    return {
      outcome: "blocked_invalid_owner_number",
      sendable: false,
      reason: "The stored owner notification number is not a valid Australian mobile.",
    };
  }
  return { outcome: "eligible", sendable: true, reason: "Eligible to send." };
}

export type OwnerNotificationRenderInput = {
  tenantName: string;
  serviceName: string | null | undefined;
  customerName: string | null | undefined;
  suburb: string | null | undefined;
  slotStart: string;
  /** The tenant's own timezone (e.g. Australia/Sydney). */
  timezone: string;
};

/** Renders the approved versioned owner template. Never model output. */
export function renderOwnerBookingConfirmation(input: OwnerNotificationRenderInput): {
  body: string;
  templateId: typeof OWNER_BOOKING_CONFIRMED_TEMPLATE_ID;
} {
  const { date, time } = formatConfirmationDateTime(input.slotStart, input.timezone);
  return {
    templateId: OWNER_BOOKING_CONFIRMED_TEMPLATE_ID,
    body: renderTemplate(OWNER_BOOKING_CONFIRMED_TEMPLATE_V1, {
      tenant_name: input.tenantName,
      service: (input.serviceName ?? "").trim() || "a booking",
      customer_name: (input.customerName ?? "").trim() || "a customer",
      suburb: (input.suburb ?? "").trim() || "their location",
      date,
      time,
    }),
  };
}

/** Kept only so callers can prove the two keys are distinct. */
export function ownerAndCustomerKeysDiffer(bookingId: string, customerKey: string): boolean {
  return ownerBookingConfirmationIdempotencyKey(bookingId) !== customerKey;
}

export { firstName as ownerFirstName };
