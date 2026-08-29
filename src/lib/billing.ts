/**
 * Pure decision logic for paid-pilot billing (Slice 2).
 *
 * Everything here is side-effect free so it can be tested directly: checkout
 * eligibility, verified-payment validation, and expiry decisions. Nothing in
 * this module provisions tenants, phone numbers or messaging.
 */
import {
  effectivePilotEnd,
  isPilotWindowExpired,
  pilotEndFor,
  type CommercialTermsSnapshot,
  type PilotAccessState,
} from "@/lib/commercial";

/** The minimal application shape the billing rules need. */
export type BillingApplication = {
  id: string;
  status: string;
  accessState: PilotAccessState;
  stripeCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  pilotStartedAt: string | null;
  pilotEndsAt: string | null;
  pilotExtensionEndsAt: string | null;
};

/** Statuses a platform admin may invite to the paid pilot. */
export const CHECKOUT_ELIGIBLE_STATUSES = ["accepted", "active"] as const;

export type EligibilityResult = { ok: true } | { ok: false; error: string };

/**
 * Checkout may be created exactly once per approved application, and never
 * for an already-paid, canceled or expired pilot.
 */
export function assertCheckoutEligible(app: BillingApplication): EligibilityResult {
  if (!(CHECKOUT_ELIGIBLE_STATUSES as readonly string[]).includes(app.status)) {
    return {
      ok: false,
      error: "Only an accepted application can be invited to the paid pilot.",
    };
  }
  if (app.accessState === "paid") {
    return { ok: false, error: "This application has already paid for a pilot." };
  }
  if (app.accessState === "canceled") {
    return { ok: false, error: "This pilot was canceled — a new commercial decision is required." };
  }
  if (app.accessState === "pilot_expired") {
    return { ok: false, error: "This pilot has expired — continuation requires admin approval." };
  }
  if (app.accessState === "past_due") {
    return { ok: false, error: "This pilot has a failed payment — resolve it before re-inviting." };
  }
  if (app.stripeSubscriptionId) {
    return { ok: false, error: "A pilot subscription already exists for this application." };
  }
  return { ok: true };
}

export type PaymentFacts = {
  currency: string;
  amountTotal: number | null;
  quantity: number | null;
};

/**
 * Never trust the client: the amount, currency and quantity that actually
 * settled are re-checked against the frozen commercial snapshot.
 */
export function validatePaymentFacts(
  facts: PaymentFacts,
  terms: Pick<CommercialTermsSnapshot, "currency" | "pilotPriceMinorUnits">,
): EligibilityResult {
  if (facts.currency.toLowerCase() !== terms.currency.toLowerCase()) {
    return { ok: false, error: `Unexpected currency ${facts.currency}` };
  }
  if (facts.amountTotal !== terms.pilotPriceMinorUnits) {
    return { ok: false, error: `Unexpected amount ${facts.amountTotal}` };
  }
  if (facts.quantity !== null && facts.quantity !== 1) {
    return { ok: false, error: `Unexpected quantity ${facts.quantity}` };
  }
  return { ok: true };
}

/** Pilot window granted by the first verified payment: exactly N days. */
export function pilotWindowFromPayment(
  paidAtIso: string,
  durationDays: number,
): { startedAt: string; endsAt: string } {
  return { startedAt: paidAtIso, endsAt: pilotEndFor(paidAtIso, durationDays) };
}

/**
 * A repeated payment event must have no additional effect: the pilot window is
 * only written when the application has not already been started by this
 * checkout session.
 */
export function shouldStartPilot(app: BillingApplication, checkoutSessionId: string): boolean {
  if (app.accessState === "paid" && app.pilotStartedAt) return false;
  if (app.stripeCheckoutSessionId === checkoutSessionId && app.pilotStartedAt) return false;
  return true;
}

/**
 * Cancellation preserves access until the paid period ends: the state only
 * drops to `canceled` once the window has actually elapsed.
 */
export function resolveCancellationState(
  app: BillingApplication,
  now: Date = new Date(),
): { accessState: PilotAccessState; reason: string } {
  if (isPilotWindowExpired(app, now)) {
    return { accessState: "canceled", reason: "Subscription canceled and pilot window elapsed" };
  }
  return {
    accessState: app.accessState,
    reason: `Subscription canceled — access preserved until ${effectivePilotEnd(app) ?? "period end"}`,
  };
}

/** Expiry only touches paid pilots whose effective end date has passed. */
export function shouldExpire(app: BillingApplication, now: Date = new Date()): boolean {
  if (app.accessState !== "paid") return false;
  return isPilotWindowExpired(app, now);
}
