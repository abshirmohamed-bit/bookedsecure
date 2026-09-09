/**
 * Subscription plans — client-safe types and pure helpers.
 *
 * Plans live in the `plans` table so pricing is never hardcoded in a screen.
 * Two are offered: Essentials and Pro. A business's plan decides how many
 * texts are included each month, what an extra text costs, whether
 * reactivation campaigns are available, and how many team members it may have.
 */
export type Plan = {
  id: string;
  name: string;
  tagline: string;
  currency: string;
  monthlyPriceMinorUnits: number;
  annualPriceMinorUnits: number;
  includedSegments: number;
  overageCents: number;
  reactivationEnabled: boolean;
  /** null means unlimited. */
  teamMemberLimit: number | null;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  sortOrder: number;
};

export const DEFAULT_PLAN_ID = "pro";

/** Provider cost per outbound text, in cents. Never sell below this. */
export const PROVIDER_COST_CENTS = 3;

export function formatMoney(amountMinorUnits: number): string {
  return `$${(amountMinorUnits / 100).toFixed(2)}`;
}

/** Months effectively free when paying a year upfront (annual vs 12 months). */
export function annualMonthsFree(plan: Plan): number {
  if (plan.monthlyPriceMinorUnits <= 0) return 0;
  const monthsPaid = plan.annualPriceMinorUnits / plan.monthlyPriceMinorUnits;
  return Math.round(12 - monthsPaid);
}

/** What a tenant pays for texts beyond the included allowance. */
export function overageCostCents(plan: Plan, segments: number): number {
  return Math.max(0, Math.round(segments)) * plan.overageCents;
}

export function planAllowsReactivation(plan: Pick<Plan, "reactivationEnabled">): boolean {
  return plan.reactivationEnabled;
}

export function planAllowsAnotherTeamMember(
  plan: Pick<Plan, "teamMemberLimit">,
  currentMembers: number,
): boolean {
  if (plan.teamMemberLimit === null) return true;
  return currentMembers < plan.teamMemberLimit;
}
