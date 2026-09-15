/**
 * Supplier cost bookkeeping (server only, platform-private).
 *
 * Every dollar a tenant pays lands in the platform's Stripe. The messaging
 * provider's share of that payment is recorded here against the tenant that
 * caused it, so the platform operator can see cost, revenue and margin per
 * tenant per month. Nothing in this module is ever read by a tenant: the two
 * tables it writes have no client access at all.
 *
 * Cost model (rates are config, not hard-coded business rules):
 *   - number_rental: the provider's monthly fee for that tenant's own number,
 *     booked once per paid subscription invoice, and only while they hold one.
 *   - credits: credits bought by a top-up, at the provider's per-text cost.
 *   - message: a text sent out of a plan's included allowance. Purchased
 *     credits are NOT booked here — their cost was already booked when the
 *     pack was paid for, so booking both would double count.
 *
 * Idempotency: every ledger row carries a `source_ref` (Stripe invoice id,
 * top-up id, message id) and the database holds a unique index on
 * (kind, source_ref). A replayed Stripe event can never spend or book twice.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Provider's monthly fee for one dedicated number, in cents. */
export const PROVIDER_NUMBER_COST_CENTS = Number(process.env["PROVIDER_NUMBER_COST_CENTS"] ?? 1500);
/** Provider's cost per text (one segment), in cents. */
export const PROVIDER_CREDIT_COST_CENTS = Number(process.env["PROVIDER_CREDIT_COST_CENTS"] ?? 3);
/** Warn the operator when the provider balance falls below this many cents. */
export const PROVIDER_BALANCE_FLOOR_CENTS = Number(process.env["PROVIDER_BALANCE_FLOOR_CENTS"] ?? 5000);

export type ProviderCostKind = "number_rental" | "credits" | "message";

export function monthKey(at: Date = new Date()): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEnd(month: string): string {
  const start = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export type LedgerResult = { recorded: boolean; duplicate: boolean };

/**
 * Write one supplier cost row. Returns `duplicate: true` when the same
 * (kind, source_ref) was already booked, which is how replayed webhooks are
 * made harmless.
 */
export async function recordProviderCost(input: {
  businessId: string;
  kind: ProviderCostKind;
  quantity: number;
  amountCents: number;
  source: string;
  sourceRef: string;
  /** Tenant payment this cost came out of, in cents (0 when none). */
  revenueCents?: number;
  metadata?: Record<string, unknown>;
  at?: Date;
}): Promise<LedgerResult> {
  const month = monthKey(input.at ?? new Date());
  const { error } = await supabaseAdmin.from("provider_costs").insert({
    business_id: input.businessId,
    month,
    kind: input.kind,
    quantity: input.quantity,
    amount_cents: input.amountCents,
    source: input.source,
    source_ref: input.sourceRef,
    metadata: {
      ...(input.metadata ?? {}),
      revenue_cents: input.revenueCents ?? 0,
    } as never,
  } as never);

  if (error) {
    // 23505 = unique violation on (kind, source_ref): already booked.
    if ((error as { code?: string }).code === "23505") return { recorded: false, duplicate: true };
    throw new Error(error.message);
  }
  return { recorded: true, duplicate: false };
}

/** True when this business currently holds its own number from the provider. */
async function holdsDedicatedNumber(businessId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("texto_numbers")
    .select("id", { count: "exact", head: true })
    .eq("assigned_business_id", businessId)
    .is("recalled_at", null);
  return (count ?? 0) > 0;
}

/**
 * A paid subscription invoice: book the provider's number fee for the month
 * out of it, and remember what the tenant paid so margin can be derived.
 * A tenant with no dedicated number is charged no rental.
 */
export async function settleSubscriptionInvoice(input: {
  businessId: string;
  invoiceId: string;
  amountPaidCents: number;
  at?: Date;
}): Promise<LedgerResult & { costCents: number }> {
  const hasNumber = await holdsDedicatedNumber(input.businessId);
  const costCents = hasNumber ? PROVIDER_NUMBER_COST_CENTS : 0;
  const result = await recordProviderCost({
    businessId: input.businessId,
    kind: "number_rental",
    quantity: hasNumber ? 1 : 0,
    amountCents: costCents,
    source: "stripe_invoice",
    sourceRef: input.invoiceId,
    revenueCents: input.amountPaidCents,
    metadata: { has_number: hasNumber },
    ...(input.at ? { at: input.at } : {}),
  });
  if (result.recorded) {
    await rebuildStatement(input.businessId, monthKey(input.at ?? new Date()));
    await checkProviderBalance(costCents);
  }
  return { ...result, costCents };
}

/**
 * A paid credit pack: the provider's cost is the credits at their per-text
 * rate; the rest of what the tenant paid is platform margin.
 */
export async function settleCreditTopup(input: {
  businessId: string;
  topupId: string;
  credits: number;
  amountCents: number;
  at?: Date;
}): Promise<LedgerResult & { costCents: number }> {
  const costCents = input.credits * PROVIDER_CREDIT_COST_CENTS;
  const result = await recordProviderCost({
    businessId: input.businessId,
    kind: "credits",
    quantity: input.credits,
    amountCents: costCents,
    source: "credit_topup",
    sourceRef: input.topupId,
    revenueCents: input.amountCents,
    ...(input.at ? { at: input.at } : {}),
  });
  if (result.recorded) {
    await rebuildStatement(input.businessId, monthKey(input.at ?? new Date()));
    await checkProviderBalance(costCents);
  }
  return { ...result, costCents };
}

/**
 * A text sent out of a plan's included allowance still costs the platform at
 * the provider. Texts paid from purchased credits are deliberately not booked
 * here — that cost was booked when the pack was paid for.
 */
export async function recordIncludedMessageCost(input: {
  businessId: string;
  messageId: string;
  segments: number;
  at?: Date;
}): Promise<LedgerResult> {
  if (input.segments <= 0) return { recorded: false, duplicate: false };
  return recordProviderCost({
    businessId: input.businessId,
    kind: "message",
    quantity: input.segments,
    amountCents: input.segments * PROVIDER_CREDIT_COST_CENTS,
    source: "included_allowance",
    sourceRef: input.messageId,
    revenueCents: 0,
    ...(input.at ? { at: input.at } : {}),
  });
}

/* ----------------------------------------------------------- statements */

export type TenantMonthStatement = {
  businessId: string;
  businessName: string | null;
  month: string;
  revenueCents: number;
  providerCostCents: number;
  marginCents: number;
  segmentsSent: number;
};

/**
 * Recompute one tenant's month from the ledgers. Derived, never incremented,
 * so a rebuild is always safe and a mid-month pull is accurate.
 */
export async function rebuildStatement(businessId: string, month: string): Promise<TenantMonthStatement> {
  const [{ data: costs }, { data: usage }] = await Promise.all([
    supabaseAdmin
      .from("provider_costs")
      .select("amount_cents, metadata")
      .eq("business_id", businessId)
      .eq("month", month),
    supabaseAdmin
      .from("sms_usage_daily")
      .select("segments_out")
      .eq("business_id", businessId)
      .gte("usage_date", month)
      .lt("usage_date", monthEnd(month)),
  ]);

  let providerCostCents = 0;
  let revenueCents = 0;
  for (const row of costs ?? []) {
    providerCostCents += row.amount_cents ?? 0;
    const meta = (row.metadata ?? {}) as { revenue_cents?: number };
    revenueCents += Number(meta.revenue_cents ?? 0);
  }
  const segmentsSent = (usage ?? []).reduce((total, row) => total + (row.segments_out ?? 0), 0);

  await supabaseAdmin
    .from("tenant_month_statements")
    .upsert(
      {
        business_id: businessId,
        month,
        revenue_cents: revenueCents,
        provider_cost_cents: providerCostCents,
        margin_cents: revenueCents - providerCostCents,
        segments_sent: segmentsSent,
        generated_at: new Date().toISOString(),
      } as never,
      { onConflict: "business_id,month" },
    );

  return {
    businessId,
    businessName: null,
    month,
    revenueCents,
    providerCostCents,
    marginCents: revenueCents - providerCostCents,
    segmentsSent,
  };
}

/** Rebuild every tenant that had activity in the month. */
export async function rebuildAllStatements(month: string = monthKey()): Promise<{ rebuilt: number }> {
  const { data } = await supabaseAdmin.from("provider_costs").select("business_id").eq("month", month);
  const ids = [...new Set((data ?? []).map((row) => row.business_id))];
  for (const id of ids) await rebuildStatement(id, month);
  return { rebuilt: ids.length };
}

/** Platform-private read: one month across every tenant, newest first. */
export async function listStatements(month: string = monthKey()): Promise<TenantMonthStatement[]> {
  const { data, error } = await supabaseAdmin
    .from("tenant_month_statements")
    .select("business_id, month, revenue_cents, provider_cost_cents, margin_cents, segments_sent, businesses(name)")
    .eq("month", month)
    .order("margin_cents", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    businessId: row.business_id,
    businessName: (row as { businesses?: { name?: string | null } }).businesses?.name ?? null,
    month: row.month,
    revenueCents: row.revenue_cents,
    providerCostCents: row.provider_cost_cents,
    marginCents: row.margin_cents,
    segmentsSent: row.segments_sent,
  }));
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** Spreadsheet-ready export for the accountant. */
export function statementsToCsv(rows: TenantMonthStatement[]): string {
  const header = "month,business_id,business,texts_sent,revenue_aud,provider_cost_aud,profit_aud";
  const lines = rows.map((row) =>
    [
      row.month,
      row.businessId,
      `"${(row.businessName ?? "").replace(/"/g, '""')}"`,
      row.segmentsSent,
      money(row.revenueCents),
      money(row.providerCostCents),
      money(row.marginCents),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

/* ------------------------------------------------------- provider balance */

export type ProviderBalance = { known: boolean; balanceCents: number | null; detail: string };

/**
 * Read the provider's account balance. Returns `known: false` when live
 * provider operations are switched off or the provider will not answer, so
 * callers never treat "unknown" as "empty".
 */
export async function readProviderBalance(): Promise<ProviderBalance> {
  const { TEXTO_API_BASE, liveAccountProvisioning } = await import("@/lib/sms/texto-accounts.server");
  const key = process.env["TEXTO_API_KEY"];
  if (!key || !liveAccountProvisioning()) {
    return { known: false, balanceCents: null, detail: "Live provider operations are off." };
  }
  try {
    const response = await fetch(`${TEXTO_API_BASE}/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const raw = await response.text();
    if (!response.ok) {
      return { known: false, balanceCents: null, detail: `Balance check failed [${response.status}]: ${raw}` };
    }
    const parsed = JSON.parse(raw) as { balance?: number | string; credit_balance?: number | string };
    const dollars = Number(parsed.balance ?? parsed.credit_balance ?? NaN);
    if (!Number.isFinite(dollars)) {
      return { known: false, balanceCents: null, detail: `Balance response not understood: ${raw}` };
    }
    return { known: true, balanceCents: Math.round(dollars * 100), detail: "ok" };
  } catch (error) {
    return {
      known: false,
      balanceCents: null,
      detail: `Balance check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * After booking a supplier cost, make sure the provider balance can still
 * cover what tenants have paid for. Alerts the operator with the exact
 * shortfall; never throws, so billing is never blocked by an alerting fault.
 */
export async function checkProviderBalance(justSpentCents = 0): Promise<ProviderBalance> {
  const balance = await readProviderBalance();
  if (!balance.known || balance.balanceCents === null) return balance;
  if (balance.balanceCents >= PROVIDER_BALANCE_FLOOR_CENTS) return balance;

  const shortfall = PROVIDER_BALANCE_FLOOR_CENTS - balance.balanceCents;
  try {
    await supabaseAdmin.from("audit_events").insert({
      business_id: null,
      event_type: "provider_balance_low",
      entity_type: "platform",
      entity_id: null,
      metadata: {
        balance_cents: balance.balanceCents,
        floor_cents: PROVIDER_BALANCE_FLOOR_CENTS,
        shortfall_cents: shortfall,
        just_spent_cents: justSpentCents,
      } as never,
    } as never);
    const url = process.env["FEEDBACK_ALERT_WEBHOOK_URL"];
    if (url) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Messaging provider balance is low: $${money(balance.balanceCents)} left. Add at least $${money(shortfall)} so tenant numbers and texts keep working.`,
        }),
      });
    }
  } catch (error) {
    console.error("[provider-costs] low balance alert failed:", error);
  }
  return balance;
}
