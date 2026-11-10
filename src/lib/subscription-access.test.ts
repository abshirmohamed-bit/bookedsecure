import { describe, expect, it } from "vitest";
import { accessLevel, describeSubscription, unlocksEverything, type SubscriptionState } from "./subscription";

const now = new Date("2026-11-10T00:00:00Z");
const state = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  status: "preview",
  planId: "platform",
  interval: "month",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  ...over,
});

describe("open access", () => {
  it("opens every feature during a running 14-day trial", () => {
    const trial = state({ status: "trialing", currentPeriodEnd: "2026-11-20T00:00:00Z" });
    expect(accessLevel(trial, now)).toBe("full");
    expect(unlocksEverything(trial, now)).toBe(true);
    expect(describeSubscription(trial, "Platform", now).detail).toMatch(/Every feature is open until/);
  });

  it("closes again when the trial has ended", () => {
    const ended = state({ status: "trialing", currentPeriodEnd: "2026-11-01T00:00:00Z" });
    expect(accessLevel(ended, now)).toBe("preview");
    expect(unlocksEverything(ended, now)).toBe(false);
  });

  it("gives complimentary businesses full access to everything, whatever the status", () => {
    const comp = state({ status: "preview", complimentary: true });
    expect(accessLevel(comp, now)).toBe("full");
    expect(unlocksEverything(comp, now)).toBe(true);
    expect(describeSubscription(comp, "Platform", now).headline).toBe("Full access · complimentary");
  });

  it("leaves paying businesses to their plan's features", () => {
    const paying = state({ status: "active" });
    expect(accessLevel(paying, now)).toBe("full");
    expect(unlocksEverything(paying, now)).toBe(false);
  });
});
