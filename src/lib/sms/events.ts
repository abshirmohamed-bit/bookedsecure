// Normalized internal messaging events.
//
// Every provider adapter translates its own webhook payloads into these types.
// Nothing outside src/lib/sms may read a provider-shaped payload, so swapping
// Telnyx for Sinch cannot reach BookedSecure business logic.

export const MESSAGING_EVENT_TYPES = [
  "message.sent",
  "message.accepted",
  "message.delivered",
  "message.failed",
  "message.received",
  "message.opted_out",
  "message.number_assigned",
  "message.number_released",
] as const;

export type MessagingEventType = (typeof MESSAGING_EVENT_TYPES)[number];

/** Internal delivery status. Deliberately provider-neutral. */
export type InternalDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "unknown";

/**
 * Provider-side diagnostics. Kept in its own object so provider status/error
 * codes are never confused with BookedSecure business status.
 */
export type ProviderDiagnostics = {
  providerId: string;
  /** Raw provider status string, for support/debugging only. */
  rawStatus: string | null;
  /** Raw provider error code, for support/debugging only. */
  rawErrorCode: string | null;
  /** Provider-reported cost in provider currency, when available. */
  cost: number | null;
};

export type NormalizedMessagingEvent = {
  type: MessagingEventType;
  /** Provider event id when supplied, otherwise a content hash (see webhook.server). */
  eventId: string | null;
  occurredAt: string;
  /** The BookedSecure-owned number involved (tenant mapping key). */
  tenantNumber: string | null;
  /** The customer number involved. */
  contactNumber: string | null;
  providerMessageId: string | null;
  /** Message text — only populated for inbound events. */
  text: string | null;
  deliveryStatus: InternalDeliveryStatus;
  provider: ProviderDiagnostics;
};

export function eventTypeForDeliveryStatus(
  status: InternalDeliveryStatus,
): MessagingEventType | null {
  switch (status) {
    case "queued":
      return "message.accepted";
    case "sent":
      return "message.sent";
    case "delivered":
      return "message.delivered";
    case "failed":
    case "undelivered":
      return "message.failed";
    default:
      return null;
  }
}

export function isFailureStatus(status: InternalDeliveryStatus): boolean {
  return status === "failed" || status === "undelivered";
}

/** Cross-tenant guard used by every webhook write path. */
export class TenantScopeError extends Error {
  constructor(expected: string, actual: string) {
    super(`Cross-tenant messaging access blocked (expected ${expected}, got ${actual}).`);
    this.name = "TenantScopeError";
  }
}

export function assertTenantMatch(expectedBusinessId: string, actualBusinessId: string): void {
  if (expectedBusinessId !== actualBusinessId) {
    throw new TenantScopeError(expectedBusinessId, actualBusinessId);
  }
}
