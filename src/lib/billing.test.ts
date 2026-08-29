import { describe, expect, it, vi } from "vitest";
import {
  assertCheckoutEligible,
  confirmRenewalPrevention,
  RENEWAL_PREVENTION_MAX_ATTEMPTS,
  pilotWindowFromPayment,
  resolveCancellationState,
  shouldExpire,
  shouldStartPilot,
  validatePaymentFacts,
  type BillingApplication,
} from "./billing";
import { hasMessagingAccess, type CommercialTermsSnapshot } from "./commercial";

const base: BillingApplication = {
  id: "app-1",
  status: "accepted",
  accessState: "pending",
  stripeCheckoutSessionId: null,
  stripeSubscriptionId: null,
  pilotStartedAt: null,
  pilotEndsAt: null,
  pilotExtensionEndsAt: null,
};

const terms: Pick<CommercialTermsSnapshot, "currency" | "pilotPriceMinorUnits"> = {
  currency: "aud",
  pilotPriceMinorUnits: 9900,
};

describe("checkout eligibility", () => {
  it("allows an accepted application with no subscription", () => {
    expect(assertCheckoutEligible(base)).toEqual({ ok: true });
  });

  it("refuses applications that were never approved", () => {
    expect(assertCheckoutEligible({ ...base, status: "pending" }).ok).toBe(false);
    expect(assertCheckoutEligible({ ...base, status: "rejected" }).ok).toBe(false);
  });

  it("refuses a second checkout for a paid, canceled or expired pilot", () => {
    for (const accessState of ["paid", "canceled", "pilot_expired", "past_due"] as const) {
      expect(assertCheckoutEligible({ ...base, accessState }).ok).toBe(false);
    }
    expect(assertCheckoutEligible({ ...base, stripeSubscriptionId: "sub_1" }).ok).toBe(false);
  });
});

describe("verified payment validation", () => {
  it("accepts exactly AUD 9900 at quantity one", () => {
    expect(
      validatePaymentFacts({ currency: "AUD", amountTotal: 9900, quantity: 1 }, terms),
    ).toEqual({ ok: true });
  });

  it("rejects wrong currency, amount or quantity", () => {
    expect(validatePaymentFacts({ currency: "usd", amountTotal: 9900, quantity: 1 }, terms).ok).toBe(false);
    expect(validatePaymentFacts({ currency: "aud", amountTotal: 4900, quantity: 1 }, terms).ok).toBe(false);
    expect(validatePaymentFacts({ currency: "aud", amountTotal: 9900, quantity: 2 }, terms).ok).toBe(false);
  });
});

describe("pilot window from the payment event", () => {
  it("grants exactly 30 days from the payment timestamp", () => {
    expect(pilotWindowFromPayment("2026-09-01T02:30:00.000Z", 30)).toEqual({
      startedAt: "2026-09-01T02:30:00.000Z",
      endsAt: "2026-10-01T02:30:00.000Z",
    });
  });

  it("is a no-op when the pilot has already started (webhook redelivery)", () => {
    const started: BillingApplication = {
      ...base,
      accessState: "paid",
      stripeCheckoutSessionId: "cs_1",
      pilotStartedAt: "2026-09-01T00:00:00.000Z",
      pilotEndsAt: "2026-10-01T00:00:00.000Z",
    };
    expect(shouldStartPilot(started, "cs_1")).toBe(false);
    expect(shouldStartPilot(started, "cs_2")).toBe(false);
    expect(shouldStartPilot(base, "cs_1")).toBe(true);
  });
});

describe("cancellation preserves paid access", () => {
  const paid: BillingApplication = {
    ...base,
    accessState: "paid",
    pilotStartedAt: "2026-09-01T00:00:00.000Z",
    pilotEndsAt: "2026-10-01T00:00:00.000Z",
  };

  it("keeps access while the paid window is open", () => {
    const result = resolveCancellationState(paid, new Date("2026-09-10T00:00:00.000Z"));
    expect(result.accessState).toBe("paid");
  });

  it("drops to canceled once the window has elapsed", () => {
    const result = resolveCancellationState(paid, new Date("2026-10-02T00:00:00.000Z"));
    expect(result.accessState).toBe("canceled");
  });
});

describe("expiry decisions", () => {
  const paid: BillingApplication = {
    ...base,
    accessState: "paid",
    pilotStartedAt: "2026-09-01T00:00:00.000Z",
    pilotEndsAt: "2026-10-01T00:00:00.000Z",
  };

  it("expires only after the effective end date", () => {
    expect(shouldExpire(paid, new Date("2026-09-30T23:59:00.000Z"))).toBe(false);
    expect(shouldExpire(paid, new Date("2026-10-01T00:00:01.000Z"))).toBe(true);
  });

  it("respects an admin extension", () => {
    const extended = { ...paid, pilotExtensionEndsAt: "2026-10-15T00:00:00.000Z" };
    expect(shouldExpire(extended, new Date("2026-10-02T00:00:00.000Z"))).toBe(false);
    expect(shouldExpire(extended, new Date("2026-10-16T00:00:00.000Z"))).toBe(true);
  });

  it("never touches applications that are not paid", () => {
    for (const accessState of ["pending", "past_due", "canceled", "pilot_expired"] as const) {
      expect(shouldExpire({ ...paid, accessState }, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    }
  });
});

describe("renewal prevention fails closed", () => {
  const noSleep = async () => {};

  it("records renewal disabled when Stripe confirms the cancellation", async () => {
    const update = vi.fn().mockResolvedValue({ cancel_at_period_end: true });
    const result = await confirmRenewalPrevention({
      subscriptionId: "sub_1",
      applicationId: "app-1",
      stripe: { update },
      sleep: noSleep,
    });
    expect(result).toEqual({ confirmed: true, attempts: 1 });
    expect(update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
      metadata: { pilotApplicationId: "app-1", no_auto_renewal: "true" },
    });
  });

  it("retries a failing Stripe call within a bounded budget", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce({ cancel_at_period_end: true });
    const result = await confirmRenewalPrevention({
      subscriptionId: "sub_1",
      applicationId: "app-1",
      stripe: { update },
      sleep: noSleep,
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.confirmed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("surfaces a repeated failure with the error and the attempt count", async () => {
    const update = vi.fn().mockRejectedValue(new Error("Stripe unavailable"));
    const result = await confirmRenewalPrevention({
      subscriptionId: "sub_1",
      applicationId: "app-1",
      stripe: { update },
      sleep: noSleep,
    });
    expect(update).toHaveBeenCalledTimes(RENEWAL_PREVENTION_MAX_ATTEMPTS);
    expect(result.confirmed).toBe(false);
    expect(result.attempts).toBe(RENEWAL_PREVENTION_MAX_ATTEMPTS);
    expect(result.error).toMatch(/Stripe unavailable/);
  });

  it("never records renewal as disabled when Stripe does not confirm it", async () => {
    for (const response of [{}, { cancel_at_period_end: false }, null, undefined]) {
      const result = await confirmRenewalPrevention({
        subscriptionId: "sub_1",
        applicationId: "app-1",
        stripe: { update: vi.fn().mockResolvedValue(response) },
        maxAttempts: 2,
        sleep: noSleep,
      });
      expect(result.confirmed).toBe(false);
      expect(result.error).toMatch(/did not confirm/i);
    }
  });

  it("blocks live messaging while renewal prevention is unconfirmed", () => {
    const paid = {
      accessState: "paid" as const,
      paymentRequired: true,
      pilotEndsAt: "2099-01-01T00:00:00.000Z",
      pilotExtensionEndsAt: null,
      stripeSubscriptionId: "sub_1",
    };
    expect(hasMessagingAccess({ ...paid, renewalPreventionConfirmed: false }).allowed).toBe(false);
    expect(hasMessagingAccess({ ...paid, renewalPreventionConfirmed: true }).allowed).toBe(true);
  });
});
