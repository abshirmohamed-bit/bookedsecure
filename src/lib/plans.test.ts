import { describe, expect, it } from "vitest";
import {
  annualMonthsFree,
  FOUNDER_PLAN_ID,
  isExternallyBilledPlan,
  overageCostCents,
  planAllowsAnotherTeamMember,
  planAllowsReactivation,
  PROVIDER_COST_CENTS,
  type Plan,
} from "@/lib/plans";

const essentials: Plan = {
  id: "essentials",
  name: "Essentials",
  tagline: "",
  currency: "aud",
  monthlyPriceMinorUnits: 20000,
  annualPriceMinorUnits: 200000,
  includedSegments: 800,
  overageCents: 9,
  reactivationEnabled: false,
  campaignsEnabled: false,
  automationCustomEnabled: false,
  teamMemberLimit: 2,
  stripeMonthlyPriceId: "essentials_monthly",
  stripeAnnualPriceId: "essentials_annual",
  sortOrder: 1,
};

const pro: Plan = {
  ...essentials,
  id: "pro",
  name: "Pro",
  monthlyPriceMinorUnits: 30000,
  annualPriceMinorUnits: 300000,
  includedSegments: 1500,
  overageCents: 8,
  reactivationEnabled: true,
  campaignsEnabled: true,
  automationCustomEnabled: true,
  teamMemberLimit: null,
  stripeMonthlyPriceId: "pro_monthly",
  stripeAnnualPriceId: "pro_annual",
  sortOrder: 2,
};

describe("subscription plans", () => {
  it("keeps every plan's included allowance and overage profitable", () => {
    for (const plan of [essentials, pro]) {
      // Texts, number ($15) and assistant ($15) must leave at least 70% margin.
      const smsCost = plan.includedSegments * PROVIDER_COST_CENTS;
      const cost = smsCost + 1500 + 1500;
      expect((plan.monthlyPriceMinorUnits - cost) / plan.monthlyPriceMinorUnits).toBeGreaterThan(
        0.7,
      );
      expect(plan.overageCents).toBeGreaterThan(PROVIDER_COST_CENTS * 2);
    }
  });

  it("gives two months free on the annual price", () => {
    expect(annualMonthsFree(essentials)).toBe(2);
    expect(annualMonthsFree(pro)).toBe(2);
  });

  it("charges extra texts at the plan rate", () => {
    expect(overageCostCents(essentials, 100)).toBe(900);
    expect(overageCostCents(pro, 100)).toBe(800);
    expect(overageCostCents(pro, -5)).toBe(0);
  });

  it("gates win-back campaigns to the higher plan", () => {
    expect(planAllowsReactivation(essentials)).toBe(false);
    expect(planAllowsReactivation(pro)).toBe(true);
  });

  it("limits team members on the lower plan only", () => {
    expect(planAllowsAnotherTeamMember(essentials, 1)).toBe(true);
    expect(planAllowsAnotherTeamMember(essentials, 2)).toBe(false);
    expect(planAllowsAnotherTeamMember(pro, 99)).toBe(true);
  });

  it("treats only the Founder plan as billed outside Stripe", () => {
    // Founder access is permanent: Stripe failures must never gate it.
    expect(isExternallyBilledPlan(FOUNDER_PLAN_ID)).toBe(true);
    expect(isExternallyBilledPlan("founder")).toBe(true);
    expect(isExternallyBilledPlan("platform")).toBe(false);
    expect(isExternallyBilledPlan("essentials")).toBe(false);
    expect(isExternallyBilledPlan("pro")).toBe(false);
  });
});
