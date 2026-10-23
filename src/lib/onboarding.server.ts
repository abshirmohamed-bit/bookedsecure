/**
 * The onboarding journey. I/O layer.
 *
 * Every fact is read from the caller's own business. Nothing here writes, apart
 * from `saveTrade`, which only ever touches the caller's own business row.
 */
import type { AppContext } from "@/lib/app-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildOnboardingSteps,
  onboardingComplete,
  type OnboardingFacts,
  type OnboardingStep,
} from "@/lib/onboarding";
import { isTradeId, type TradeId } from "@/lib/trades";

export type OnboardingSnapshot = {
  role: AppContext["role"];
  trade: TradeId | null;
  businessName: string | null;
  facts: OnboardingFacts;
  steps: OnboardingStep[];
  complete: boolean;
};

export async function readOnboardingSnapshot(app: AppContext): Promise<OnboardingSnapshot> {
  const { readBusinessIdentity } = await import("@/lib/tenant-identity.server");
  const { accessLevel } = await import("@/lib/subscription");
  const { getSubscriptionForBusiness } = await import("@/lib/subscription.server");

  const [business, services, leads, campaigns, identity, subscription] = await Promise.all([
    supabaseAdmin.from("businesses").select("name, trade").eq("id", app.businessId).maybeSingle(),
    supabaseAdmin
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("business_id", app.businessId)
      .eq("active", true),
    supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", app.businessId),
    supabaseAdmin
      .from("reactivation_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("business_id", app.businessId),
    readBusinessIdentity(app),
    getSubscriptionForBusiness(app.businessId),
  ]);

  const trade = isTradeId(business.data?.trade) ? (business.data!.trade as TradeId) : null;

  const facts: OnboardingFacts = {
    tradeChosen: trade !== null,
    serviceCount: services.count ?? 0,
    complianceComplete: identity.exists && identity.missing.length === 0,
    subscriptionActive: accessLevel(subscription) === "full",
    importedContacts: leads.count ?? 0,
    campaignsCreated: campaigns.count ?? 0,
  };

  return {
    role: app.role,
    trade,
    businessName: business.data?.name ?? null,
    facts,
    steps: buildOnboardingSteps(facts),
    complete: onboardingComplete(facts),
  };
}

/**
 * Owner-only: records what the business does, and. only when the business has
 * no services at all. adds that trade's starting services so a business
 * without a website still has something to work with. Anything already saved is
 * left exactly as it is.
 */
export async function saveTrade(
  app: AppContext,
  trade: string,
): Promise<{ trade: TradeId; seededServices: number }> {
  if (app.role === "staff") throw new Error("Only the business owner can change these settings.");
  if (!isTradeId(trade)) throw new Error("That is not one of the trades we support yet.");
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({ trade })
    .eq("id", app.businessId);
  if (error) throw new Error(error.message);

  const seededServices = await seedStarterServices(app, trade);
  await supabaseAdmin.from("audit_events").insert({
    business_id: app.businessId,
    user_id: app.userId,
    event_type: "trade_changed",
    entity_type: "business",
    entity_id: app.businessId,
    metadata: { trade, seeded_services: seededServices },
  });
  return { trade, seededServices };
}

/**
 * Adds the trade's starting services, but only to a business with none. Returns
 * how many were added, so nothing is ever claimed that did not happen.
 */
async function seedStarterServices(app: AppContext, trade: TradeId): Promise<number> {
  const { TRADE_PRESETS } = await import("@/lib/trades");
  const { count } = await supabaseAdmin
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("business_id", app.businessId);
  if ((count ?? 0) > 0) return 0;

  const rows = TRADE_PRESETS[trade].serviceSeeds.map((seed) => ({
    business_id: app.businessId,
    name: seed.name,
    category: null,
    description: null,
    price_guidance: null,
    duration_minutes: seed.durationMinutes,
    campaign_eligible: true,
    active: true,
  }));
  const { error } = await supabaseAdmin.from("services").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}
