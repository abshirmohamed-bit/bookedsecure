/**
 * Pure decision logic for paid-pilot billing (Slice 2).
 *
 * Everything here is side-effect free so it can be tested directly: checkout
 * eligibility, verified-payment validation, and expiry decisions. Nothing in
 * this module provisions tenants, phone numbers or messaging.
 */
import {
  effectivePilotEnd,
  isMessagingEligibleState,
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
  if (app.accessState === "paid_by_platform_credits") {
    return {
      ok: false,
      error:
        "This pilot's consideration was satisfied by platform credits — no Stripe checkout may be created.",
    };
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
  // Consideration satisfied off-Stripe: no payment event may ever rewrite the
  // recorded pilot window.
  if (app.accessState === "paid_by_platform_credits") return false;
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

/** Expiry only touches active pilots whose effective end date has passed. */
export function shouldExpire(app: BillingApplication, now: Date = new Date()): boolean {
  if (!isMessagingEligibleState(app.accessState)) return false;
  return isPilotWindowExpired(app, now);
}


/* --------------------------------------------------- renewal prevention */

/** Bounded retry budget for confirming Stripe renewal cancellation. */
export const RENEWAL_PREVENTION_MAX_ATTEMPTS = 3;

/** Minimal Stripe surface needed to switch renewal off (injectable for tests). */
export type RenewalCanceler = {
  update(
    id: string,
    params: { cancel_at_period_end: boolean; metadata?: Record<string, string> },
  ): Promise<{ cancel_at_period_end?: boolean | null } | null | undefined>;
};

export type RenewalPreventionResult = { confirmed: boolean; attempts: number; error?: string };

/**
 * Fail-closed renewal prevention.
 *
 * The pilot is a single 30-day period, so the subscription must never renew.
 * `confirmed` is true only when Stripe echoes back `cancel_at_period_end:
 * true` — a thrown error, a missing field or a `false` value are all treated
 * as "not disabled", after a bounded number of retries. Nothing is charged,
 * refunded or otherwise cancelled here.
 */
export async function confirmRenewalPrevention(input: {
  subscriptionId: string;
  applicationId: string;
  stripe: RenewalCanceler;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<RenewalPreventionResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? RENEWAL_PREVENTION_MAX_ATTEMPTS);
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError = "Stripe did not confirm cancel_at_period_end.";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const updated = await input.stripe.update(input.subscriptionId, {
        cancel_at_period_end: true,
        metadata: { pilotApplicationId: input.applicationId, no_auto_renewal: "true" },
      });
      if (updated?.cancel_at_period_end === true) return { confirmed: true, attempts: attempt };
      lastError = "Stripe did not confirm cancel_at_period_end.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < maxAttempts) await sleep(200 * attempt);
  }

  return { confirmed: false, attempts: maxAttempts, error: lastError };
}
