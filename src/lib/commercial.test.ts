import { describe, expect, it } from "vitest";
import {
  addDays,
  effectivePilotEnd,
  hasMessagingAccess,
  isPilotAccessState,
  isPilotWindowExpired,
  pilotEndFor,
  snapshotTerms,
  withinSegmentCap,
  type CommercialConfig,
} from "./commercial";

const config: CommercialConfig = {
  id: "cfg-1",
  currency: "aud",
  pilotPriceMinorUnits: 9900,
  billingInterval: "month",
  includedSmsSegments: 250,
  overageMode: "hard_cap",
  pilotDurationDays: 30,
  supportChannel: "email",
  supportAddress: "support@bookedsecure.com.au",
  supportTargetBusinessDays: 1,
  cancellationTerms: "cancel_before_next_renewal",
  pilotEndAction: "pause",
  stripeProductId: "bookedsecure_paid_pilot",
  stripeRecurringPriceId: "paid_pilot_monthly",
  configurationVersion: 1,
  updatedAt: "2026-08-29T00:00:00.000Z",
};

const NOW = new Date("2026-08-29T12:00:00.000Z");

describe("pilot dates", () => {
  it("adds whole days in UTC", () => {
    expect(addDays("2026-08-01T10:30:00.000Z", 30)).toBe("2026-08-31T10:30:00.000Z");
    expect(addDays("2026-12-20T00:00:00.000Z", 30)).toBe("2027-01-19T00:00:00.000Z");
  });

  it("ends the pilot 30 days after it starts", () => {
    expect(pilotEndFor("2026-08-01T09:00:00.000Z", 30)).toBe("2026-08-31T09:00:00.000Z");
  });

  it("uses the extension end when it is later, never shortens the pilot", () => {
    const pilot = {
      pilotEndsAt: "2026-08-31T09:00:00.000Z",
      pilotExtensionEndsAt: "2026-09-15T09:00:00.000Z",
    };
    expect(effectivePilotEnd(pilot)).toBe("2026-09-15T09:00:00.000Z");
    expect(
      effectivePilotEnd({ ...pilot, pilotExtensionEndsAt: "2026-08-01T00:00:00.000Z" }),
    ).toBe("2026-08-31T09:00:00.000Z");
    expect(effectivePilotEnd({ pilotEndsAt: null, pilotExtensionEndsAt: null })).toBeNull();
  });

  it("detects an elapsed window but not an open one", () => {
    const open = { pilotEndsAt: "2026-09-28T12:00:00.000Z", pilotExtensionEndsAt: null };
    const elapsed = { pilotEndsAt: "2026-08-01T00:00:00.000Z", pilotExtensionEndsAt: null };
    expect(isPilotWindowExpired(open, NOW)).toBe(false);
    expect(isPilotWindowExpired(elapsed, NOW)).toBe(true);
  });
});

describe("messaging access states", () => {
  const paidPilot = {
    accessState: "paid" as const,
    paymentRequired: true,
    pilotEndsAt: "2026-09-28T12:00:00.000Z",
    pilotExtensionEndsAt: null,
  };

  it("recognises exactly the six PRD access states", () => {
    for (const state of ["pending", "paid", "past_due", "canceled", "paused", "pilot_expired"]) {
      expect(isPilotAccessState(state)).toBe(true);
    }
    expect(isPilotAccessState("active")).toBe(false);
    expect(isPilotAccessState("trialing")).toBe(false);
  });

  it("allows messaging only for a paid pilot inside its window", () => {
    expect(hasMessagingAccess(paidPilot, NOW).allowed).toBe(true);
  });

  it("blocks messaging before payment", () => {
    const result = hasMessagingAccess({ ...paidPilot, accessState: "pending" }, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/payment is required/i);
  });

  it("blocks past_due, canceled and paused pilots", () => {
    for (const accessState of ["past_due", "canceled", "paused"] as const) {
      expect(hasMessagingAccess({ ...paidPilot, accessState }, NOW).allowed).toBe(false);
    }
  });

  it("blocks an elapsed pilot even if the row still says paid", () => {
    const result = hasMessagingAccess(
      { ...paidPilot, pilotEndsAt: "2026-08-01T00:00:00.000Z" },
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/pilot period has ended/i);
  });

  it("honours an admin extension past the original end", () => {
    const result = hasMessagingAccess(
      {
        ...paidPilot,
        pilotEndsAt: "2026-08-01T00:00:00.000Z",
        pilotExtensionEndsAt: "2026-09-30T00:00:00.000Z",
      },
      NOW,
    );
    expect(result.allowed).toBe(true);
  });
});

describe("250-segment hard cap boundary", () => {
  it("allows sends up to and including exactly 250 segments", () => {
    expect(withinSegmentCap(0, 1, 250)).toBe(true);
    expect(withinSegmentCap(249, 1, 250)).toBe(true);
    expect(withinSegmentCap(248, 2, 250)).toBe(true);
  });

  it("blocks the 251st segment", () => {
    expect(withinSegmentCap(250, 1, 250)).toBe(false);
    expect(withinSegmentCap(249, 2, 250)).toBe(false);
  });

  it("never goes negative", () => {
    expect(withinSegmentCap(0, 0, 250)).toBe(true);
  });
});

describe("commercial terms snapshot", () => {
  it("captures every commercial term with the configuration version", () => {
    const snapshot = snapshotTerms(config);
    expect(snapshot).toEqual({
      configurationVersion: 1,
      currency: "aud",
      pilotPriceMinorUnits: 9900,
      billingInterval: "month",
      includedSmsSegments: 250,
      overageMode: "hard_cap",
      pilotDurationDays: 30,
      supportChannel: "email",
      supportAddress: "support@bookedsecure.com.au",
      supportTargetBusinessDays: 1,
      cancellationTerms: "cancel_before_next_renewal",
      pilotEndAction: "pause",
      stripeProductId: "bookedsecure_paid_pilot",
      stripeRecurringPriceId: "paid_pilot_monthly",
    });
  });

  it("is a frozen copy — later config changes do not mutate it", () => {
    const snapshot = snapshotTerms(config);
    const changed = { ...config, includedSmsSegments: 500, configurationVersion: 2 };
    expect(snapshot.includedSmsSegments).toBe(250);
    expect(snapshot.configurationVersion).toBe(1);
    expect(snapshotTerms(changed).includedSmsSegments).toBe(500);
  });
});
