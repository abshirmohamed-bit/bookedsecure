/**
 * Regression tests for the `paid_by_platform_credits` access state.
 *
 * Glocast's pilot consideration was satisfied through the Glocast-funded
 * Lovable workspace subscription / platform credits, not through a Stripe
 * payment inside BookedSecure. These tests prove the state:
 *   - grants messaging access only inside the recorded 30-day window,
 *   - cannot be mistaken for a Stripe-paid subscription,
 *   - cannot create a second charge or be rewritten by a Stripe event,
 *   - still expires and still respects the 250-segment hard cap.
 */
import { describe, expect, it } from "vitest";
import {
  MESSAGING_ELIGIBLE_STATES,
  hasMessagingAccess,
  isMessagingEligibleState,
  isPilotAccessState,
  isStripePaidState,
  pilotEndFor,
  withinSegmentCap,
} from "@/lib/commercial";
import { assertCheckoutEligible, shouldExpire, shouldStartPilot } from "@/lib/billing";
import type { BillingApplication } from "@/lib/billing";

const STARTED = "2026-08-29T00:00:00.000Z";
const ENDS = pilotEndFor(STARTED, 30); // exactly 30 days

const creditPilot = {
  accessState: "paid_by_platform_credits" as const,
  paymentRequired: false,
  pilotStartedAt: STARTED,
  pilotEndsAt: ENDS,
  pilotExtensionEndsAt: null,
  stripeSubscriptionId: null,
  renewalPreventionConfirmed: true,
};

const creditApp: BillingApplication = {
  id: "app-glocast",
  status: "active",
  accessState: "paid_by_platform_credits",
  stripeCheckoutSessionId: null,
  stripeSubscriptionId: null,
  pilotStartedAt: STARTED,
  pilotEndsAt: ENDS,
  pilotExtensionEndsAt: null,
};

describe("paid_by_platform_credits — state model", () => {
  it("is a recognised access state and messaging-eligible", () => {
    expect(isPilotAccessState("paid_by_platform_credits")).toBe(true);
    expect(isMessagingEligibleState("paid_by_platform_credits")).toBe(true);
    expect([...MESSAGING_ELIGIBLE_STATES]).toEqual(["paid", "paid_by_platform_credits"]);
  });

  it("is never treated as a Stripe-paid subscription", () => {
    expect(isStripePaidState("paid_by_platform_credits")).toBe(false);
    expect(isStripePaidState("paid")).toBe(true);
    expect(creditApp.stripeSubscriptionId).toBeNull();
    expect(creditApp.stripeCheckoutSessionId).toBeNull();
  });
});

describe("paid_by_platform_credits — 30-day window only", () => {
  it("allows messaging inside the window", () => {
    expect(hasMessagingAccess(creditPilot, new Date("2026-09-10T00:00:00.000Z")).allowed).toBe(true);
  });

  it("ends exactly 30 days after the start", () => {
    expect(ENDS).toBe("2026-09-28T00:00:00.000Z");
    const justBefore = new Date(new Date(ENDS).getTime() - 60_000);
    const atEnd = new Date(ENDS);
    expect(hasMessagingAccess(creditPilot, justBefore).allowed).toBe(true);
    expect(hasMessagingAccess(creditPilot, atEnd).allowed).toBe(false);
    expect(hasMessagingAccess(creditPilot, atEnd).reason).toBe("The pilot period has ended.");
  });

  it("still honours every other access gate", () => {
    const inWindow = new Date("2026-09-10T00:00:00.000Z");
    for (const accessState of ["pending", "past_due", "canceled", "paused", "pilot_expired"] as const) {
      const result = hasMessagingAccess({ ...creditPilot, accessState, paymentRequired: true }, inWindow);
      expect(result.allowed).toBe(false);
    }
  });

  it("expiry pass demotes it once the window elapses", () => {
    expect(shouldExpire(creditApp, new Date("2026-09-10T00:00:00.000Z"))).toBe(false);
    expect(shouldExpire(creditApp, new Date(ENDS))).toBe(true);
  });
});

describe("paid_by_platform_credits — no duplicate billing, no renewal", () => {
  it("cannot be invited to Stripe checkout", () => {
    const result = assertCheckoutEligible(creditApp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/platform credits/i);
  });

  it("cannot have its pilot window rewritten by a Stripe payment event", () => {
    expect(shouldStartPilot(creditApp, "cs_test_anything")).toBe(false);
  });

  it("has no subscription that could renew, so the fail-closed renewal gate is inert", () => {
    expect(creditPilot.stripeSubscriptionId).toBeNull();
    expect(hasMessagingAccess(creditPilot, new Date("2026-09-10T00:00:00.000Z")).allowed).toBe(true);
  });
});

describe("paid_by_platform_credits — 250-segment hard cap preserved", () => {
  it("allows up to and including 250 segments and blocks the 251st", () => {
    expect(withinSegmentCap(249, 1, 250)).toBe(true);
    expect(withinSegmentCap(250, 1, 250)).toBe(false);
    expect(withinSegmentCap(0, 250, 250)).toBe(true);
    expect(withinSegmentCap(0, 251, 250)).toBe(false);
  });
});
