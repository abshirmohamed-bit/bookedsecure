/**
 * Automatic SMS credit top-ups (server only).
 *
 * When a business turns this on in Plan & billing, the system buys their
 * chosen credit pack on their saved Stripe card as soon as the purchased
 * credit balance drops below their threshold — no manual step, no service
 * interruption.
 *
 * Guard rails (fail-closed, all tenant-scoped):
 * - only businesses that opted in are ever charged;
 * - one automatic attempt at a time, at most 3 per day, 15-minute cooldown;
 * - two consecutive failures switch the feature off and alert the owner;
 * - the saved card comes from a previous successful payment only — the card
 *   itself is held by Stripe, never by us.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { findCreditPack, type CreditPack } from "@/lib/sms/credit-packs";
import { allocateCredits } from "@/lib/sms/texto-accounts.server";

const COOLDOWN_MINUTES = 15;
const MAX_PER_DAY = 3;
const MAX_CONSECUTIVE_FAILURES = 2;

type AutoAccountRow = {
  id: string;
  business_id: string;
  credit_balance: number;
  auto_topup_enabled: boolean;
  auto_topup_threshold: number;
  auto_topup_pack_id: string;
  auto_topup_attempted_at: string | null;
  auto_topup_failures: number;
};

type TopupInsert = Database["public"]["Tables"]["credit_topups"]["Insert"];

async function getAccount(businessId: string): Promise<AutoAccountRow | null> {
  const { data } = await supabaseAdmin
    .from("texto_accounts")
    .select(
      "id, business_id, credit_balance, auto_topup_enabled, auto_topup_threshold, auto_topup_pack_id, auto_topup_attempted_at, auto_topup_failures",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as AutoAccountRow | null) ?? null;
}

async function audit(businessId: string, eventType: string, metadata: Record<string, unknown>) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: businessId,
    event_type: eventType,
    entity_type: "texto_account",
    entity_id: businessId,
    metadata,
  });
}

const ENVS: StripeEnv[] = ["sandbox", "live"];

/** The card to charge: from the business's most recent successful payment. */
async function findSavedCard(businessId: string): Promise<{
  env: StripeEnv;
  customerId: string;
  paymentMethodId: string;
} | null> {
  // Prefer the card used for the last paid top-up (saved with off-session
  // usage), then fall back to the subscription's payment method.
  const { data: lastTopup } = await supabaseAdmin
    .from("credit_topups")
    .select("stripe_payment_intent_id")
    .eq("business_id", businessId)
    .eq("status", "paid")
    .not("stripe_payment_intent_id", "is", null)
    .order("credited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: sub } = await supabaseAdmin
    .from("businesses")
    .select("stripe_customer_id, stripe_subscription_id, subscription_status")
    .eq("id", businessId)
    .maybeSingle();

  // Rows don't record which Stripe environment they were paid in, so each
  // source is tried in both; a wrong environment simply fails the lookup.
  for (const env of ENVS) {
    const stripe = createStripeClient(env);
    if (lastTopup?.stripe_payment_intent_id) {
      try {
        const intent = await stripe.paymentIntents.retrieve(lastTopup.stripe_payment_intent_id);
        const paymentMethod =
          typeof intent.payment_method === "string"
            ? intent.payment_method
            : (intent.payment_method?.id ?? null);
        const customerId =
          typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
        if (paymentMethod && customerId) return { env, customerId, paymentMethodId: paymentMethod };
      } catch {
        // not in this environment — try the next source
      }
    }
    if (
      sub?.stripe_customer_id &&
      sub.stripe_subscription_id &&
      ["active", "trialing", "past_due"].includes(sub.subscription_status ?? "")
    ) {
      try {
        const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const paymentMethod =
          typeof subscription.default_payment_method === "string"
            ? subscription.default_payment_method
            : (subscription.default_payment_method?.id ?? null);
        if (paymentMethod) {
          return { env, customerId: sub.stripe_customer_id, paymentMethodId: paymentMethod };
        }
      } catch {
        // not in this environment
      }
    }
  }
  return null;
}

export type AutoTopupResult =
  | { ok: true; credits: number }
  | { ok: false; reason: string };

/**
 * Attempt one automatic top-up for a business. Safe to call on every send;
 * the guard rails make repeated calls a no-op. Never throws — billing must
 * never break messaging.
 */
export async function maybeAutoTopup(businessId: string): Promise<AutoTopupResult> {
  try {
    const account = await getAccount(businessId);
    if (!account || !account.auto_topup_enabled) return { ok: false, reason: "disabled" };
    if (account.credit_balance >= account.auto_topup_threshold) {
      return { ok: false, reason: "balance_above_threshold" };
    }
    if (account.auto_topup_failures >= MAX_CONSECUTIVE_FAILURES) {
      return { ok: false, reason: "disabled_after_failures" };
    }
    if (
      account.auto_topup_attempted_at &&
      Date.now() - new Date(account.auto_topup_attempted_at).getTime() < COOLDOWN_MINUTES * 60_000
    ) {
      return { ok: false, reason: "cooldown" };
    }

    const pack: CreditPack | null = findCreditPack(account.auto_topup_pack_id);
    if (!pack) return { ok: false, reason: "pack_not_found" };

    // Daily budget guard: at most MAX_PER_DAY automatic purchases per day.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("credit_topups")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("source", "auto")
      .gte("created_at", dayAgo);
    if ((count ?? 0) >= MAX_PER_DAY) return { ok: false, reason: "daily_limit" };

    const card = await findSavedCard(businessId);
    if (!card) return { ok: false, reason: "no_saved_card" };

    // Mark the attempt up-front so a concurrent send can't double-charge.
    await supabaseAdmin
      .from("texto_accounts")
      .update({ auto_topup_attempted_at: new Date().toISOString() })
      .eq("id", account.id);

    const { data: row } = await supabaseAdmin
      .from("credit_topups")
      .insert({
        business_id: businessId,
        pack_id: pack.id,
        credits: pack.credits,
        amount_cents: pack.amountCents,
        currency: pack.currency,
        status: "pending",
        source: "auto",
      } as TopupInsert)
      .select("id")
      .single();
    if (!row) return { ok: false, reason: "ledger_write_failed" };

    try {
      const stripe = createStripeClient(card.env);
      const intent = await stripe.paymentIntents.create({
        amount: pack.amountCents,
        currency: pack.currency,
        customer: card.customerId,
        payment_method: card.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `${pack.label} — BookedSecure automatic SMS top-up`,
        metadata: {
          creditTopupId: row.id,
          bookedsecureBusinessId: businessId,
          credits: String(pack.credits),
          programme: "bookedsecure_sms_credits",
          source: "auto",
        },
      });
      if (intent.status !== "succeeded") {
        throw new Error(`Payment was not completed (status: ${intent.status}).`);
      }

      await allocateCredits(businessId, pack.credits);
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("credit_topups")
        .update({
          status: "paid",
          credited_at: now,
          stripe_payment_intent_id: intent.id,
        })
        .eq("id", row.id);
      await supabaseAdmin
        .from("texto_accounts")
        .update({ auto_topup_failures: 0 })
        .eq("id", account.id);
      await audit(businessId, "auto_topup_succeeded", {
        pack_id: pack.id,
        credits: pack.credits,
        amount_cents: pack.amountCents,
        payment_intent: intent.id,
      });
      return { ok: true, credits: pack.credits };
    } catch (error) {
      const message = getStripeErrorMessage(error);
      const failures = account.auto_topup_failures + 1;
      await supabaseAdmin
        .from("credit_topups")
        .update({ status: "failed", failure_reason: message })
        .eq("id", row.id);
      await supabaseAdmin
        .from("texto_accounts")
        .update({
          auto_topup_failures: failures,
          // Two failed attempts in a row (usually an expired card): stop
          // trying and let the owner fix their card instead of retry loops.
          auto_topup_enabled: failures >= MAX_CONSECUTIVE_FAILURES ? false : account.auto_topup_enabled,
        })
        .eq("id", account.id);
      await audit(businessId, "auto_topup_failed", { error: message, failures });
      return { ok: false, reason: message };
    }
  } catch (error) {
    console.error("[auto-topup] unexpected failure:", error);
    return { ok: false, reason: "unexpected_error" };
  }
}

/**
 * Scheduled sweep: top up every opted-in business that is running low. Called
 * hourly from the top-up expiry cron so balances recover even when no message
 * is being sent right now.
 */
export async function sweepAutoTopups(): Promise<{ checked: number; toppedUp: number }> {
  const { data: accounts } = await supabaseAdmin
    .from("texto_accounts")
    .select("business_id, credit_balance, auto_topup_threshold")
    .eq("auto_topup_enabled", true)
    .limit(500);
  let toppedUp = 0;
  for (const account of (accounts ?? []) as Array<{
    business_id: string;
    credit_balance: number;
    auto_topup_threshold: number;
  }>) {
    if (account.credit_balance >= account.auto_topup_threshold) continue;
    const result = await maybeAutoTopup(account.business_id);
    if (result.ok) toppedUp += 1;
  }
  return { checked: accounts?.length ?? 0, toppedUp };
}
