import { describe, expect, it } from "vitest";
import {
  buildOnboardingSteps,
  isBehindPaywall,
  onboardingComplete,
  onboardingProgressLabel,
  type OnboardingFacts,
} from "@/lib/onboarding";

const fresh: OnboardingFacts = {
  tradeChosen: false,
  serviceCount: 0,
  complianceComplete: false,
  subscriptionActive: false,
  importedContacts: 0,
  campaignsCreated: 0,
};

describe("onboarding journey", () => {
  it("starts a brand new business on the trade step", () => {
    const steps = buildOnboardingSteps(fresh);
    expect(steps[0]!.id).toBe("trade");
    expect(steps[0]!.current).toBe(true);
    expect(steps.filter((s) => s.current)).toHaveLength(1);
    expect(onboardingProgressLabel(steps)).toBe("0 of 6 done");
  });

  it("holds importing and campaigns behind the subscription", () => {
    const steps = buildOnboardingSteps({
      ...fresh,
      tradeChosen: true,
      serviceCount: 3,
      complianceComplete: true,
    });
    expect(steps.find((s) => s.id === "subscribe")!.current).toBe(true);
    expect(steps.find((s) => s.id === "import")!.blockedBy).toBe("subscribe");
    expect(steps.find((s) => s.id === "campaign")!.blockedBy).toBe("subscribe");
    expect(isBehindPaywall("website")).toBe(false);
    expect(isBehindPaywall("import")).toBe(true);
  });

  it("opens importing once the subscription is active", () => {
    const steps = buildOnboardingSteps({
      tradeChosen: true,
      serviceCount: 3,
      complianceComplete: true,
      subscriptionActive: true,
      importedContacts: 0,
      campaignsCreated: 0,
    });
    const importStep = steps.find((s) => s.id === "import")!;
    expect(importStep.blockedBy).toBeNull();
    expect(importStep.current).toBe(true);
  });

  it("reports the journey finished only when every step is done", () => {
    const done: OnboardingFacts = {
      tradeChosen: true,
      serviceCount: 2,
      complianceComplete: true,
      subscriptionActive: true,
      importedContacts: 120,
      campaignsCreated: 1,
    };
    expect(onboardingComplete(done)).toBe(true);
    expect(onboardingComplete({ ...done, campaignsCreated: 0 })).toBe(false);
    expect(buildOnboardingSteps(done).every((s) => !s.current)).toBe(true);
  });
});
