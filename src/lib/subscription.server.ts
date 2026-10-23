/**
 * Server-side subscription authority.
 *
 * One place answers "may this business do X right now?" so every write path
 * (server functions, assistant tools, automation) and every UI surface reads
 * the same truth. Nothing here special-cases a tenant.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_PLAN_ID, type Plan } from "@/lib/plans";
import { getPlanForBusiness } from "@/lib/plans.server";
import {
  accessLevel,
  planIncludes,
  PREVIEW_MESSAGE,
  upgradeMessage,
  type AccessLevel,
  type BillingInterval,
  type PlanFeature,
  type SubscriptionState,
  type SubscriptionStatus,
} from "@/lib/subscription";

type BusinessRow = Database["public"]["Tables"]["businesses"]["Row"];
type UsagePeriodRow = Database["public"]["Tables"]["sms_usage_periods"]["Row"];

const SUBSCRIPTION_COLUMNS =
  "id, plan_id, subscription_status, billing_interval, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end, past_due_since";

type SubscriptionRow = Pick<
  BusinessRow,
  | "id"
  | "plan_id"
  | "subscription_status"
  | "billing_interval"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "current_period_start"
  | "current_period_end"
  | "cancel_at_period_end"
  | "past_due_since"
>;

export function toSubscriptionState(row: SubscriptionRow): SubscriptionState {
  return {
    status: (row.subscription_status as SubscriptionStatus) ?? "preview",
    planId: row.plan_id ?? DEFAULT_PLAN_ID,
    interval: (row.billing_interval as BillingInterval) ?? "month",
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
    pastDueSince: row.past_due_since,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

export async function getSubscriptionForBusiness(businessId: string): Promise<SubscriptionState> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Business not found.");
  return toSubscriptionState(data);
}

export async function getAccessLevel(businessId: string, now: Date = new Date()): Promise<AccessLevel> {
  return accessLevel(await getSubscriptionForBusiness(businessId), now);
}

/** Throws the plain-language preview message when the business is not paying. */
export async function requireActiveSubscription(businessId: string): Promise<SubscriptionState> {
  const state = await getSubscriptionForBusiness(businessId);
  if (accessLevel(state) !== "full") throw new Error(PREVIEW_MESSAGE);
  return state;
}

/**
 * Throws when the plan does not include `feature`. Also requires an active
 * subscription, since no plan feature is available in preview.
 */
export async function requirePlanFeature(businessId: string, feature: PlanFeature): Promise<Plan> {
  await requireActiveSubscription(businessId);
  const plan = await getPlanForBusiness(businessId);
  if (!planIncludes(plan, feature)) throw new Error(upgradeMessage(feature));
  return plan;
}

/** Non-throwing variant for Assistant tools: the upgrade message, or null when allowed. */
export async function planGateMessage(businessId: string, feature: PlanFeature): Promise<string | null> {
  try {
    await requirePlanFeature(businessId, feature);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Team seats: Essentials allows a fixed number of active members, Pro is
 * unlimited. Called before a member is (re)activated or invited.
 */
export async function assertTeamSeatAvailable(businessId: string): Promise<void> {
  await requireActiveSubscription(businessId);
  const plan = await getPlanForBusiness(businessId);
  if (plan.teamMemberLimit === null) return;
  const { count } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("active", true);
  if ((count ?? 0) >= plan.teamMemberLimit) {
    throw new Error(
      `Your plan includes ${plan.teamMemberLimit} team members. Upgrade to Pro for unlimited team access.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Included-text allowance per billing period
// ---------------------------------------------------------------------------

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/**
 * Find or create the usage period covering `now` for a subscribed business.
 * Monthly plans follow the Stripe period; yearly plans reset the allowance
 * every month anchored on the subscription start.
 */
export async function ensureBusinessUsagePeriod(
  businessId: string,
  state: SubscriptionState,
  plan: Plan,
  now: Date = new Date(),
): Promise<UsagePeriodRow> {
  const nowIso = now.toISOString();
  const { data: existing } = await supabaseAdmin
    .from("sms_usage_periods")
    .select("*")
    .eq("business_id", businessId)
    .is("pilot_application_id", null)
    .lte("period_start", nowIso)
    .gt("period_end", nowIso)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const anchor = state.currentPeriodStart ? new Date(state.currentPeriodStart) : now;
  let start = new Date(anchor);
  while (addMonths(start, 1).getTime() <= now.getTime()) start = addMonths(start, 1);
  const end = addMonths(start, 1);

  const { data, error } = await supabaseAdmin
    .from("sms_usage_periods")
    .insert({
      pilot_application_id: null,
      business_id: businessId,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      included_segments: plan.includedSegments,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export type UsageSummary = {
  includedSegments: number;
  segmentsUsed: number;
  segmentsBlocked: number;
  periodStart: string;
  periodEnd: string;
} | null;

/** Current-period usage for the UI; null when the business is not subscribed. */
export async function getUsageSummary(businessId: string, now: Date = new Date()): Promise<UsageSummary> {
  const state = await getSubscriptionForBusiness(businessId);
  if (accessLevel(state, now) !== "full") return null;
  const plan = await getPlanForBusiness(businessId);
  const period = await ensureBusinessUsagePeriod(businessId, state, plan, now);
  return {
    includedSegments: period.included_segments,
    segmentsUsed: period.segments_used,
    segmentsBlocked: period.segments_blocked,
    periodStart: period.period_start,
    periodEnd: period.period_end,
  };
}

// ---------------------------------------------------------------------------
// Purchased credits
// ---------------------------------------------------------------------------

/** Atomically spend purchased credits; false when the balance is short. */
export async function spendPurchasedCredits(businessId: string, credits: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("spend_sms_credits", {
    p_business_id: businessId,
    p_credits: credits,
  });
  if (error) throw new Error(error.message);
  return data !== null && data !== undefined;
}

export async function refundPurchasedCredits(businessId: string, credits: number): Promise<void> {
  await supabaseAdmin.rpc("refund_sms_credits", { p_business_id: businessId, p_credits: credits });
}

// ---------------------------------------------------------------------------
// Writes from the billing webhook
// ---------------------------------------------------------------------------

export async function applySubscriptionState(
  businessId: string,
  patch: Partial<{
    status: SubscriptionStatus;
    planId: string;
    interval: BillingInterval;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pastDueSince: string | null;
  }>,
): Promise<void> {
  const update: Database["public"]["Tables"]["businesses"]["Update"] = {
    subscription_updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.subscription_status = patch.status;
  if (patch.planId !== undefined) update.plan_id = patch.planId;
  if (patch.interval !== undefined) update.billing_interval = patch.interval;
  if (patch.stripeCustomerId !== undefined) update.stripe_customer_id = patch.stripeCustomerId;
  if (patch.stripeSubscriptionId !== undefined) update.stripe_subscription_id = patch.stripeSubscriptionId;
  if (patch.currentPeriodStart !== undefined) update.current_period_start = patch.currentPeriodStart;
  if (patch.currentPeriodEnd !== undefined) update.current_period_end = patch.currentPeriodEnd;
  if (patch.cancelAtPeriodEnd !== undefined) update.cancel_at_period_end = patch.cancelAtPeriodEnd;
  if (patch.pastDueSince !== undefined) update.past_due_since = patch.pastDueSince;
  const { error } = await supabaseAdmin.from("businesses").update(update).eq("id", businessId);
  if (error) throw new Error(error.message);
}

export async function findBusinessByStripeSubscription(subscriptionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function findBusinessByStripeCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}
