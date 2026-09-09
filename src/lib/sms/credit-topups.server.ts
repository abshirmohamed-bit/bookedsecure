/**
 * Self-serve SMS credit top-ups (server only).
 *
 * A top-up is a one-off Stripe payment that adds credits to exactly one
 * business's Texto account. The `credit_topups` row is the ledger: credits are
 * only ever added by the webhook, once, after Stripe confirms the settled
 * amount matches the pack that was sold.
 *
 * Deliberately out of scope: numbers, provider credentials and the pilot
 * subscription. Nothing here can enable live sending.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { findCreditPack, type CreditPack } from "@/lib/sms/credit-packs";
import { allocateCredits } from "@/lib/sms/texto-accounts.server";

export type CreditTopupRow = Database["public"]["Tables"]["credit_topups"]["Row"];

/** Credit packs are sold in the same Stripe environment as the paid pilot. */
export function topupStripeEnv(): StripeEnv {
  return "sandbox";
}

export type TopupCheckoutResult = { clientSecret: string; topupId: string } | { error: string };

async function resolveCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  input: { businessId: string; businessName: string | null; email: string | null },
): Promise<string> {
  const found = await stripe.customers.search({
    query: `metadata['bookedsecureBusinessId']:'${input.businessId}'`,
    limit: 1,
  });
  const existing = found.data[0];
  if (existing) return existing.id;
  const created = await stripe.customers.create({
    ...(input.email ? { email: input.email } : {}),
    ...(input.businessName ? { name: input.businessName } : {}),
    metadata: { bookedsecureBusinessId: input.businessId },
  });
  return created.id;
}

/**
 * Create an embedded checkout session for one credit pack and one business.
 * The pending ledger row is written before Stripe is called, so a payment can
 * never arrive without a row to settle it against.
 */
export async function createCreditTopupCheckout(input: {
  businessId: string;
  packId: string;
  userId: string;
  email: string | null;
  returnUrl: string;
}): Promise<TopupCheckoutResult> {
  const pack: CreditPack | null = findCreditPack(input.packId);
  if (!pack) return { error: "That credit pack is not available." };

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("id, name")
    .eq("id", input.businessId)
    .maybeSingle();
  if (!business) return { error: "Business not found." };

  const { data: row, error: insertError } = await supabaseAdmin
    .from("credit_topups")
    .insert({
      business_id: input.businessId,
      requested_by: input.userId,
      pack_id: pack.id,
      credits: pack.credits,
      amount_cents: pack.amountCents,
      currency: pack.currency,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !row) return { error: insertError?.message ?? "Could not start the top-up." };

  try {
    const stripe = createStripeClient(topupStripeEnv());

    const prices = await stripe.prices.list({ lookup_keys: [pack.priceId] });
    const price = prices.data[0];
    if (!price) return { error: "The credit pack price could not be found." };
    if ((price.currency ?? "").toLowerCase() !== pack.currency) {
      return { error: "The credit pack price is not in Australian dollars." };
    }
    if (price.unit_amount !== pack.amountCents) {
      return { error: "The credit pack price does not match the advertised amount." };
    }

    const customerId = await resolveCustomer(stripe, {
      businessId: input.businessId,
      businessName: business.name,
      email: input.email,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: false,
      payment_intent_data: { description: `${pack.label} — BookedSecure SMS top-up` },
      metadata: {
        creditTopupId: row.id,
        bookedsecureBusinessId: input.businessId,
        credits: String(pack.credits),
        programme: "bookedsecure_sms_credits",
      },
    });

    await supabaseAdmin
      .from("credit_topups")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", row.id);

    if (!session.client_secret) return { error: "Stripe did not return a checkout session." };
    return { clientSecret: session.client_secret, topupId: row.id };
  } catch (error) {
    const message = getStripeErrorMessage(error);
    await supabaseAdmin
      .from("credit_topups")
      .update({ status: "failed", failure_reason: message })
      .eq("id", row.id);
    return { error: message };
  }
}

/**
 * Settle one paid credit-pack session. Idempotent: a row already marked `paid`
 * is left untouched, so Stripe redelivery never double-credits a business.
 */
export async function handleCreditTopupSession(
  session: any,
  eventCreated: number,
): Promise<{ ok: boolean; detail: string }> {
  const topupId: string | undefined = session.metadata?.creditTopupId;
  if (!topupId) return { ok: false, detail: "No credit top-up id on session" };

  const { data: row } = await supabaseAdmin
    .from("credit_topups")
    .select("id, business_id, credits, amount_cents, currency, status")
    .eq("id", topupId)
    .maybeSingle();
  if (!row) return { ok: false, detail: "No matching credit top-up" };
  if (row.status === "paid") return { ok: true, detail: "Credit top-up already applied" };

  const currency = (session.currency ?? "").toLowerCase();
  const amountTotal: number | null = session.amount_total ?? null;
  if (currency !== row.currency || amountTotal !== row.amount_cents) {
    await supabaseAdmin
      .from("credit_topups")
      .update({
        status: "failed",
        failure_reason: `Unexpected settled amount (${amountTotal} ${currency})`,
      })
      .eq("id", row.id);
    return { ok: false, detail: "Credit top-up amount did not match the pack" };
  }

  await allocateCredits(row.business_id, row.credits);

  const paidAt = new Date(eventCreated * 1000).toISOString();
  await supabaseAdmin
    .from("credit_topups")
    .update({
      status: "paid",
      credited_at: paidAt,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
    })
    .eq("id", row.id);

  await supabaseAdmin.from("audit_events").insert({
    business_id: row.business_id,
    event_type: "sms_credits_topped_up",
    entity_type: "credit_topup",
    entity_id: row.id,
    metadata: { credits: row.credits, amount_cents: row.amount_cents, currency: row.currency },
  });

  return { ok: true, detail: `Added ${row.credits} SMS credits` };
}

export async function listCreditTopups(businessId: string, limit = 5) {
  const { data, error } = await supabaseAdmin
    .from("credit_topups")
    .select("id, pack_id, credits, amount_cents, currency, status, created_at, credited_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
