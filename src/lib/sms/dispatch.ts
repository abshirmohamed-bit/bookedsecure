// Pure outbound-dispatch safety rules. No I/O, so both the engine and the
// tests share exactly the same decisions.

import type { InternalDeliveryStatus } from "./events";

/** Status written before the carrier call. a reservation, not a send. */
export const RESERVED_STATUS: InternalDeliveryStatus = "queued";
/** Carrier accepted or rejected is unknown: needs reconciliation, never a resend. */
export const UNKNOWN_STATUS: InternalDeliveryStatus = "unknown";

export type CarrierFailureClass = "confirmed_rejection" | "unknown_outcome";

const AMBIGUOUS_PATTERNS = [
  /timeout|timed out/i,
  /abort/i,
  /network|fetch failed|socket|ECONN|EPIPE|ETIMEDOUT|ENOTFOUND/i,
  /\[(?:429|5\d\d)\]/,
];

/**
 * A rejection is only "confirmed" when the carrier answered with a definite
 * client-side refusal. Transport failures and 429/5xx answers are ambiguous:
 * the message may well have been accepted, so it must never be auto-resent and
 * reserved segments must not be released.
 */
export function classifyCarrierFailure(error: unknown): CarrierFailureClass {
  const message = error instanceof Error ? error.message : String(error);
  return AMBIGUOUS_PATTERNS.some((p) => p.test(message))
    ? "unknown_outcome"
    : "confirmed_rejection";
}

/** Segments are only returned to the allowance for a confirmed pre-dispatch failure. */
export function shouldReleaseSegments(failure: CarrierFailureClass): boolean {
  return failure === "confirmed_rejection";
}

/**
 * Only a confirmed failure may be retried with the same idempotency key.
 * `queued`/`unknown` rows hold the key so a retry cannot dispatch twice.
 */
export function canReuseOutboundRow(deliveryStatus: string): boolean {
  return deliveryStatus === "failed";
}
