/**
 * Owner control room (platform-private).
 *
 * Read-only aggregation for the person who runs BookedSecure: what came in,
 * what the provider costs, what is left, which tenants need something done.
 * Nothing here is ever exposed to a tenant — every function is called behind
 * `requirePlatformAdmin`, and the two money tables have no client access at all.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  listStatements,
  monthKey,
  readProviderBalance,
  type ProviderBalance,
  type TenantMonthStatement,
} from "@/lib/provider-costs.server";
import { tradeLabel } from "@/lib/trades";

export type MoneySummary = {
  month: string;
  revenueCents: number;
  providerCostCents: number;
  marginCents: number;
  segmentsSent: number;
  tenantsBilled: number;
  creditPackRevenueCents: number;
  subscriptions: { active: number; pastDue: number; canceled: number; none: number };
  providerBalance: ProviderBalance;
};

export type TenantRow = {
  businessId: string;
  name: string;
  trade: string | null;
  planId: string;
  subscriptionStatus: string;
  numbers: number;
  creditBalance: number;
  leads: number;
  segmentsSent: number;
  marginCents: number;
  complianceComplete: boolean;
};

export type WorkQueue = {
  waitingOnNumber: TenantRow[];
  waitingOnCredits: TenantRow[];
  incompleteCompliance: TenantRow[];
  paymentProblem: TenantRow[];
};

const ACTIVE_STATES = ["active", "trialing", "founder", "paid", "paid_by_platform_credits"];

export async function readOwnerConsole(month: string = monthKey()): Promise<{
  money: MoneySummary;
  tenants: TenantRow[];
  queue: WorkQueue;
}> {
  const [businesses, statements, numbers, leadCounts, topups, balance] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id, name, trade, plan_id, subscription_status")
      .order("name"),
    listStatements(month),
    supabaseAdmin.from("texto_numbers").select("assigned_business_id, status"),
    supabaseAdmin.from("leads").select("business_id"),
    supabaseAdmin.from("credit_topups").select("business_id, status, amount_cents, created_at"),
    readProviderBalance(),
  ]);

  const identities = await supabaseAdmin.from("business_identity").select("business_id, status");
  const accounts = await supabaseAdmin
    .from("texto_accounts")
    .select("business_id, credit_balance");

  const statementBy = new Map<string, TenantMonthStatement>(
    statements.map((row) => [row.businessId, row]),
  );
  const numbersBy = new Map<string, number>();
  for (const row of numbers.data ?? []) {
    const id = row.assigned_business_id;
    if (!id || row.status === "recalled") continue;
    numbersBy.set(id, (numbersBy.get(id) ?? 0) + 1);
  }
  const leadsBy = new Map<string, number>();
  for (const row of leadCounts.data ?? []) {
    leadsBy.set(row.business_id, (leadsBy.get(row.business_id) ?? 0) + 1);
  }
  const creditsBy = new Map<string, number>();
  for (const row of accounts.data ?? []) {
    if (!row.business_id) continue;
    creditsBy.set(row.business_id, Number(row.credit_balance ?? 0));
  }
  const identityBy = new Set(
    (identities.data ?? []).filter((row) => row.business_id).map((row) => row.business_id as string),
  );

  const tenants: TenantRow[] = (businesses.data ?? []).map((business) => {
    const statement = statementBy.get(business.id);
    return {
      businessId: business.id,
      name: business.name,
      trade: tradeLabel(business.trade),
      planId: business.plan_id,
      subscriptionStatus: business.subscription_status,
      numbers: numbersBy.get(business.id) ?? 0,
      creditBalance: creditsBy.get(business.id) ?? 0,
      leads: leadsBy.get(business.id) ?? 0,
      segmentsSent: statement?.segmentsSent ?? 0,
      marginCents: statement?.marginCents ?? 0,
      complianceComplete: identityBy.has(business.id),
    };
  });

  const subscriptions = { active: 0, pastDue: 0, canceled: 0, none: 0 };
  for (const tenant of tenants) {
    if (ACTIVE_STATES.includes(tenant.subscriptionStatus)) subscriptions.active += 1;
    else if (tenant.subscriptionStatus === "past_due") subscriptions.pastDue += 1;
    else if (tenant.subscriptionStatus === "canceled") subscriptions.canceled += 1;
    else subscriptions.none += 1;
  }

  const monthStart = new Date(`${month}T00:00:00Z`).getTime();
  const creditPackRevenueCents = (topups.data ?? [])
    .filter(
      (row) =>
        row.status === "paid" && new Date(row.created_at ?? 0).getTime() >= monthStart,
    )
    .reduce((total, row) => total + Number(row.amount_cents ?? 0), 0);

  const money: MoneySummary = {
    month,
    revenueCents: statements.reduce((total, row) => total + row.revenueCents, 0),
    providerCostCents: statements.reduce((total, row) => total + row.providerCostCents, 0),
    marginCents: statements.reduce((total, row) => total + row.marginCents, 0),
    segmentsSent: statements.reduce((total, row) => total + row.segmentsSent, 0),
    tenantsBilled: statements.length,
    creditPackRevenueCents,
    subscriptions,
    providerBalance: balance,
  };

  const paying = tenants.filter((tenant) => ACTIVE_STATES.includes(tenant.subscriptionStatus));
  const queue: WorkQueue = {
    // Buying a number and topping credits up is still done by hand, so these
    // two lists are the operator's real to-do list, not a guess.
    waitingOnNumber: paying.filter((tenant) => tenant.numbers === 0),
    waitingOnCredits: paying.filter((tenant) => tenant.numbers > 0 && tenant.creditBalance <= 0),
    incompleteCompliance: tenants.filter(
      (tenant) => !tenant.complianceComplete && tenant.subscriptionStatus !== "canceled",
    ),
    paymentProblem: tenants.filter((tenant) => tenant.subscriptionStatus === "past_due"),
  };

  return { money, tenants, queue };
}
