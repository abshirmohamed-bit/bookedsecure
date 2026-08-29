/**
 * BookedSecure paid-pilot commercial model — shared types and pure logic.
 *
 * Commercial terms (price, included segments, duration, support, cancellation)
 * live in the single `commercial_config` row and are edited by platform
 * administrators only. Changes apply to new pilots: every accepted pilot
 * stores an immutable `CommercialTermsSnapshot` taken at invitation time.
 *
 * No tenant, phone number or messaging may be provisioned before payment —
 * `hasMessagingAccess` is the single source of truth for that decision.
 */

export const PILOT_ACCESS_STATES = [
  "pending",
  "paid",
  "past_due",
  "canceled",
  "paused",
  "pilot_expired",
] as const;

export type PilotAccessState = (typeof PILOT_ACCESS_STATES)[number];

export function isPilotAccessState(value: string): value is PilotAccessState {
  return (PILOT_ACCESS_STATES as readonly string[]).includes(value);
}

/** Row shape of the singleton public.commercial_config record. */
export type CommercialConfig = {
  id: string;
  currency: string;
  pilotPriceMinorUnits: number;
  billingInterval: string;
  includedSmsSegments: number;
  overageMode: "hard_cap";
  pilotDurationDays: number;
  supportChannel: string;
  supportAddress: string;
  supportTargetBusinessDays: number;
  cancellationTerms: string;
  pilotEndAction: string;
  stripeProductId: string | null;
  stripeRecurringPriceId: string | null;
  configurationVersion: number;
  updatedAt: string;
};

/** Immutable copy of the terms an individual pilot was accepted under. */
export type CommercialTermsSnapshot = {
  configurationVersion: number;
  currency: string;
  pilotPriceMinorUnits: number;
  billingInterval: string;
  includedSmsSegments: number;
  overageMode: "hard_cap";
  pilotDurationDays: number;
  supportChannel: string;
  supportAddress: string;
  supportTargetBusinessDays: number;
  cancellationTerms: string;
  pilotEndAction: string;
  stripeProductId: string | null;
  stripeRecurringPriceId: string | null;
};

export function snapshotTerms(config: CommercialConfig): CommercialTermsSnapshot {
  return {
    configurationVersion: config.configurationVersion,
    currency: config.currency,
    pilotPriceMinorUnits: config.pilotPriceMinorUnits,
    billingInterval: config.billingInterval,
    includedSmsSegments: config.includedSmsSegments,
    overageMode: config.overageMode,
    pilotDurationDays: config.pilotDurationDays,
    supportChannel: config.supportChannel,
    supportAddress: config.supportAddress,
    supportTargetBusinessDays: config.supportTargetBusinessDays,
    cancellationTerms: config.cancellationTerms,
    pilotEndAction: config.pilotEndAction,
    stripeProductId: config.stripeProductId,
    stripeRecurringPriceId: config.stripeRecurringPriceId,
  };
}

/** The commercial fields the engine needs from a pilot_applications row. */
export type PilotCommercialRecord = {
  id: string;
  businessId: string | null;
  accessState: PilotAccessState;
  paymentRequired: boolean;
  pilotStartedAt: string | null;
  pilotEndsAt: string | null;
  pilotExtensionEndsAt: string | null;
  includedSmsSegments: number;
};

export function addDays(isoDate: string, days: number): string {
  return new Date(new Date(isoDate).getTime() + days * 86_400_000).toISOString();
}

/** The end date a pilot starts with: start + configured duration (30 days). */
export function pilotEndFor(startIso: string, durationDays: number): string {
  return addDays(startIso, durationDays);
}

/** Admin extensions replace the scheduled end — never shorten it. */
export function effectivePilotEnd(
  pilot: Pick<PilotCommercialRecord, "pilotEndsAt" | "pilotExtensionEndsAt">,
): string | null {
  if (!pilot.pilotEndsAt) return null;
  if (
    pilot.pilotExtensionEndsAt &&
    new Date(pilot.pilotExtensionEndsAt).getTime() > new Date(pilot.pilotEndsAt).getTime()
  ) {
    return pilot.pilotExtensionEndsAt;
  }
  return pilot.pilotEndsAt;
}

/** True when the pilot window has run out at `now`. */
export function isPilotWindowExpired(
  pilot: Pick<PilotCommercialRecord, "pilotEndsAt" | "pilotExtensionEndsAt">,
  now: Date = new Date(),
): boolean {
  const end = effectivePilotEnd(pilot);
  return !!end && now.getTime() >= new Date(end).getTime();
}

/**
 * Messaging is allowed only when payment has completed (state `paid`) and the
 * pilot window is still open. No payment → no provisioning, no live SMS.
 */
export function hasMessagingAccess(
  pilot: Pick<
    PilotCommercialRecord,
    "accessState" | "paymentRequired" | "pilotEndsAt" | "pilotExtensionEndsAt"
  > & { stripeSubscriptionId?: string | null; renewalPreventionConfirmed?: boolean },
  now: Date = new Date(),
): { allowed: boolean; reason: string } {
  if (pilot.paymentRequired && pilot.accessState === "pending") {
    return { allowed: false, reason: "Payment is required before messaging can be used." };
  }
  if (pilot.accessState === "canceled") {
    return { allowed: false, reason: "This pilot has been canceled." };
  }
  if (pilot.accessState === "paused") {
    return { allowed: false, reason: "This pilot is currently paused." };
  }
  if (pilot.accessState === "past_due") {
    return { allowed: false, reason: "A subscription payment is past due — messaging is on hold." };
  }
  if (pilot.accessState === "pilot_expired" || isPilotWindowExpired(pilot, now)) {
    return { allowed: false, reason: "The pilot period has ended." };
  }
  if (pilot.accessState !== "paid") {
    return { allowed: false, reason: "Messaging is not enabled for this account." };
  }
  // Fail closed: a live subscription whose renewal cancellation is unconfirmed
  // must not be treated as a safe, single-period pilot.
  if (pilot.stripeSubscriptionId && pilot.renewalPreventionConfirmed === false) {
    return {
      allowed: false,
      reason: "Automatic renewal is not confirmed as disabled — messaging is on hold.",
    };
  }
  return { allowed: true, reason: "" };
}


/**
 * Hard-cap boundary check: the send is allowed when it fits inside the
 * included allowance — exactly 250/250 passes, the 251st segment is blocked.
 * The authoritative enforcement is the atomic `reserve_sms_segments` SQL
 * function; this mirrors it for tests and pre-flight checks.
 */
export function withinSegmentCap(used: number, incoming: number, included: number): boolean {
  return used + incoming <= included;
}
