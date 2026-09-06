// Shared operational booking-confirmation SMS policy — pure, tenant-agnostic.
//
// This is an OPERATIONAL confirmation only. It is never a campaign, a
// follow-up, a reactivation, a promotion or general outbound AI. Nothing here
// performs I/O, so the server path and the tests share exactly one decision.
//
// Reusable for every tenant: every tenant-specific value (name, timezone,
// callback number, quiet window) is passed in from that tenant's own
// configuration. No number, name or timezone is ever hardcoded.

import { firstName, isQuietHour, normaliseAuMobile, renderTemplate } from "@/lib/domain";

/** Versioned, fixed-field template. The AI can never author confirmation copy. */
export const BOOKING_CONFIRMATION_TEMPLATE_ID = "booking_confirmation.v2" as const;

export const BOOKING_CONFIRMATION_TEMPLATE_V2 =
  "Hi {{customer_first_name}}, your {{tenant_name}} booking for {{service}} is confirmed for {{date}} at {{time}} ({{tenant_timezone}}). Questions? Call {{customer_callback_number}}. Reply STOP to opt out.";

/** Observable outcome for one confirmation event. */
export type ConfirmationOutcome =
  | "eligible"
  | "queued_quiet_hours"
  | "sent"
  | "delivered"
  | "failed"
  | "duplicate_suppressed"
  | "blocked_no_booking"
  | "blocked_cancelled"
  | "blocked_consent_missing"
  | "blocked_opted_out"
  | "blocked_suppressed"
  | "blocked_invalid_number"
  | "blocked_missing_callback_number";

export type ConfirmationFacts = {
  /** Authoritative booking state, read from the committed records. */
  offerStatus: string | null | undefined;
  jobId: string | null | undefined;
  confirmationSentAt: string | null | undefined;
  /** Customer eligibility. */
  consentStatus: string | null | undefined;
  optedOutAt: string | null | undefined;
  smsSuppressedAt: string | null | undefined;
  mobileNumber: string | null | undefined;
  /** The tenant's own configured customer-facing callback number. */
  tenantCallbackNumber: string | null | undefined;
  /** The tenant's saved business/personal mobile (Account details). */
  ownerNotificationNumber?: string | null | undefined;
};

export type ConfirmationDecision = {
  outcome: ConfirmationOutcome;
  sendable: boolean;
  reason: string;
};

function validAuContactNumber(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  return normaliseAuMobile(raw) ?? (/^\+61[2-9]\d{8}$/.test(raw) ? raw : null);
}

/**
 * The number customers are told to call on the confirmation SMS. This is the
 * tenant's own physical business/personal mobile saved in Account details
 * ("Mobile number"); the public callback number is only a fallback when no
 * owner mobile is stored. Never the platform sending line by default, and
 * never a platform-wide default: no valid number blocks the send.
 */
export function resolveTenantCallbackNumber(
  business:
    | { phone_number?: string | null; owner_notification_number?: string | null }
    | null
    | undefined,
): string | null {
  return (
    validAuContactNumber(business?.owner_notification_number) ??
    validAuContactNumber(business?.phone_number)
  );
}

/** Single eligibility decision for an operational booking confirmation. */
export function evaluateConfirmationEligibility(facts: ConfirmationFacts): ConfirmationDecision {
  if (facts.offerStatus !== "confirmed" || !facts.jobId) {
    const cancelled = facts.offerStatus === "withdrawn" || facts.offerStatus === "expired";
    return {
      outcome: cancelled ? "blocked_cancelled" : "blocked_no_booking",
      sendable: false,
      reason: cancelled
        ? "The booking was cancelled before the confirmation was sent."
        : "No committed booking and job exist for this confirmation event.",
    };
  }
  if (facts.confirmationSentAt) {
    return {
      outcome: "duplicate_suppressed",
      sendable: false,
      reason: "A confirmation has already been sent for this booking.",
    };
  }
  if (facts.optedOutAt) {
    return { outcome: "blocked_opted_out", sendable: false, reason: "Customer has opted out (STOP)." };
  }
  if (facts.smsSuppressedAt) {
    return { outcome: "blocked_suppressed", sendable: false, reason: "Customer number is suppressed." };
  }
  if (!facts.mobileNumber || !normaliseAuMobile(facts.mobileNumber)) {
    return {
      outcome: "blocked_invalid_number",
      sendable: false,
      reason: "Customer mobile number is missing or invalid.",
    };
  }
  if (facts.consentStatus !== "granted") {
    return {
      outcome: "blocked_consent_missing",
      sendable: false,
      reason: "Customer consent for SMS is not recorded.",
    };
  }
  if (
    !resolveTenantCallbackNumber({
      phone_number: facts.tenantCallbackNumber ?? null,
      owner_notification_number: facts.ownerNotificationNumber ?? null,
    })
  ) {
    return {
      outcome: "blocked_missing_callback_number",
      sendable: false,
      reason:
        "This business has no valid customer-facing callback number configured — the confirmation SMS was not sent and no other number was substituted.",
    };
  }
  return { outcome: "eligible", sendable: true, reason: "Eligible to send." };
}

// ---------------------------------------------------------------------------
// Tenant-timezone rendering
// ---------------------------------------------------------------------------

function zoneParts(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"] === "24" ? "0" : map["hour"]),
    minute: Number(map["minute"]),
    second: Number(map["second"]),
  };
}

function zoneOffsetMs(timezone: string, at: Date): number {
  const p = zoneParts(timezone, at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime();
}

/** Wall-clock time in a tenant timezone → the exact UTC instant (DST-safe). */
export function zonedWallTimeToUtc(
  timezone: string,
  y: number,
  m: number,
  d: number,
  hour: number,
): Date {
  let ts = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i += 1) {
    ts = Date.UTC(y, m - 1, d, hour) - zoneOffsetMs(timezone, new Date(ts));
  }
  return new Date(ts);
}

/** Customer-facing date and time strings, always in the tenant timezone. */
export function formatConfirmationDateTime(
  slotStart: string,
  timezone: string,
): { date: string; time: string } {
  const at = new Date(slotStart);
  return {
    date: new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(at),
    time: new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(at)
      .toLowerCase(),
  };
}

export type ConfirmationRenderInput = {
  customerName: string | null | undefined;
  tenantName: string;
  serviceName: string | null | undefined;
  slotStart: string;
  timezone: string;
  callbackNumber: string;
};

/** Renders the approved versioned template. Never model output. */
export function renderBookingConfirmation(input: ConfirmationRenderInput): {
  body: string;
  templateId: typeof BOOKING_CONFIRMATION_TEMPLATE_ID;
} {
  const { date, time } = formatConfirmationDateTime(input.slotStart, input.timezone);
  return {
    templateId: BOOKING_CONFIRMATION_TEMPLATE_ID,
    body: renderTemplate(BOOKING_CONFIRMATION_TEMPLATE_V2, {
      customer_first_name: firstName(input.customerName?.trim() || "there"),
      tenant_name: input.tenantName,
      service: (input.serviceName ?? "").trim() || "your booking",
      date,
      time,
      tenant_timezone: input.timezone,
      customer_callback_number: input.callbackNumber,
    }),
  };
}

// ---------------------------------------------------------------------------
// Overnight queueing
// ---------------------------------------------------------------------------

export type QuietWindow = { timezone: string; quiet_hours_start: number; quiet_hours_end: number };

/**
 * Null when the confirmation may go out now; otherwise the exact instant at
 * which it is released — the tenant's own quiet-window end hour (08:00 for a
 * tenant configured that way), in the tenant's own timezone. Never earlier.
 */
export function confirmationReleaseAt(window: QuietWindow, now: Date): Date | null {
  const local = zoneParts(window.timezone, now);
  if (!isQuietHour(local.hour, window.quiet_hours_start, window.quiet_hours_end)) return null;

  const releaseHour = window.quiet_hours_end;
  let release = zonedWallTimeToUtc(window.timezone, local.year, local.month, local.day, releaseHour);
  if (release.getTime() <= now.getTime()) {
    const nextDay = zoneParts(window.timezone, new Date(now.getTime() + 24 * 60 * 60 * 1000));
    release = zonedWallTimeToUtc(window.timezone, nextDay.year, nextDay.month, nextDay.day, releaseHour);
  }
  return release;
}

/** Idempotency key for the queued release job — one per booking offer. */
export function confirmationJobIdempotencyKey(offerId: string): string {
  return `booking_confirmation_release:${offerId}`;
}
