/**
 * Server-side plan authority.
 *
 * One place resolves "what plan is this business on", so every surface
 * (messaging page, reactivation, team settings, send gates) asks the same
 * question and no tenant is ever special-cased in code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_PLAN_ID, type Plan } from "@/lib/plans";

type PlanRow = Database["public"]["Tables"]["plans"]["Row"];

export function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    currency: row.currency,
    monthlyPriceMinorUnits: row.monthly_price_minor_units,
    annualPriceMinorUnits: row.annual_price_minor_units,
    includedSegments: row.included_segments,
    overageCents: row.overage_cents,
    reactivationEnabled: row.reactivation_enabled,
    campaignsEnabled: row.campaigns_enabled,
    automationCustomEnabled: row.automation_custom_enabled,
    teamMemberLimit: row.team_member_limit,
    stripeMonthlyPriceId: row.stripe_monthly_price_id,
    stripeAnnualPriceId: row.stripe_annual_price_id,
    sortOrder: row.sort_order,
  };
}

/** The plans currently offered, cheapest first. */
export async function listOfferedPlans(): Promise<Plan[]> {
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select("*")
    .eq("is_offered", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPlan);
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const { data } = await supabaseAdmin.from("plans").select("*").eq("id", planId).maybeSingle();
  return data ? toPlan(data) : null;
}

/** The plan a business is on; falls back to the default plan if unset. */
export async function getPlanForBusiness(businessId: string): Promise<Plan> {
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("plan_id")
    .eq("id", businessId)
    .maybeSingle();
  const plan = await getPlanById(business?.plan_id ?? DEFAULT_PLAN_ID);
  if (plan) return plan;
  const fallback = await getPlanById(DEFAULT_PLAN_ID);
  if (!fallback) throw new Error("No subscription plans are configured.");
  return fallback;
}

/**
 * Throws a plain-language error when the business's plan does not include
 * reactivation campaigns. Used by every reactivation entry point.
 */
export async function requireReactivationPlan(businessId: string): Promise<Plan> {
  const { requirePlanFeature } = await import("@/lib/subscription.server");
  return await requirePlanFeature(businessId, "reactivation");
}
