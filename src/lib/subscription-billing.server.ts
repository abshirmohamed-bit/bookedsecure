/**
 * Essentials / Pro subscription billing (server only).
 *
 * - `createSubscriptionCheckout` opens an embedded Stripe checkout for one
 *   plan + interval, tied to exactly one business.
 * - `createBillingPortalSession` lets the owner change card, switch plan or
 *   cancel in Stripe's hosted portal.
 * - The `handle*` functions are called from the verified webhook and are the
 *   only writers of a business's subscription state.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPlanById, listAllPlans } from "@/lib/plans.server";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import type { BillingInterval, SubscriptionStatus } from "@/lib/subscription";
import {
  applySubscriptionState,
  findBusinessByStripeCustomer,
  findBusinessByStripeSubscription,
  getSubscriptionForBusiness,
} from "@/lib/subscription.server";

type Stripe = ReturnType<typeof createStripeClient>;

export type SubscriptionCheckoutResult = { clientSecret: string } | { error: string };
export type PortalResult = { url: string } | { error: string };

async function audit(businessId: string, eventType: string, metadata: Record<string, unknown>, userId?: string | null) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: businessId,
    user_id: userId ?? null,
    event_type: eventType,
    entity_type: "business",
    entity_id: businessId,
    metadata: metadata as never,
  });
}

/** One Stripe customer per business, found by metadata so it survives email changes. */
export async function resolveBusinessCustomer(
  stripe: Stripe,
  input: { businessId: string; businessName: string | null; email: string | null },
): Promise<string> {
  const state = await getSubscriptionForBusiness(input.businessId);
  if (state.stripeCustomerId) {
    // A stored id belongs to whichever environment created it. Test-mode ids do
    // not exist in live (and vice versa), so confirm it before reusing it —
    // otherwise checkout fails with "No such customer".
    try {
      const stored = await stripe.customers.retrieve(state.stripeCustomerId);
      if (!("deleted" in stored) || !stored.deleted) return state.stripeCustomerId;
    } catch {
      // Unknown in this environment: fall through and resolve a fresh customer.
    }
  }

  const found = await stripe.customers.search({
    query: `metadata['bookedsecureBusinessId']:'${input.businessId}'`,
    limit: 1,
  });
  const existing = found.data[0];
  const customerId = existing
    ? existing.id
    : (
        await stripe.customers.create({
          ...(input.email ? { email: input.email } : {}),
          ...(input.businessName ? { name: input.businessName } : {}),
          metadata: { bookedsecureBusinessId: input.businessId },
        })
      ).id;
  await applySubscriptionState(input.businessId, { stripeCustomerId: customerId });
  return customerId;
}

export async function createSubscriptionCheckout(input: {
  businessId: string;
  userId: string;
  email: string | null;
  planId: string;
  interval: BillingInterval;
  returnUrl: string;
  environment: StripeEnv;
}): Promise<SubscriptionCheckoutResult> {
  // A plan is only sellable to this business if it is publicly offered or a
  // promo code has unlocked it for them — the browser's planId is never trusted.
  const { listPlansForBusiness } = await import("@/lib/plans.server");
  const sellable = await listPlansForBusiness(input.businessId);
  const plan = sellable.find((candidate) => candidate.id === input.planId) ?? null;
  if (!plan) return { error: "That plan is not available." };
  const lookupKey = input.interval === "year" ? plan.stripeAnnualPriceId : plan.stripeMonthlyPriceId;
  if (!lookupKey) return { error: "That plan has no price configured yet." };

  const state = await getSubscriptionForBusiness(input.businessId);
  if (state.stripeSubscriptionId && state.status !== "canceled") {
    return { error: "You already have a subscription. Use Manage billing to change plan." };
  }

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("id, name")
    .eq("id", input.businessId)
    .maybeSingle();
  if (!business) return { error: "Business not found." };

  try {
    const stripe = createStripeClient(input.environment);
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data[0];
    if (!price) return { error: "That plan's price is not available right now." };

    const customerId = await resolveBusinessCustomer(stripe, {
      businessId: input.businessId,
      businessName: business.name,
      email: input.email,
    });

    // Never sell a second subscription to the same business. If Stripe already
    // holds a live one (for example a webhook that was missed), link it and
    // send the owner to Manage billing instead of charging them again.
    const live = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    const existing = live.data.find((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status));
    if (existing) {
      await syncSubscription(existing, input.businessId);
      return { error: "You already have a subscription. Use Manage billing to change plan." };
    }

    const metadata = {
      bookedsecureBusinessId: input.businessId,
      bookedsecureSubscription: "true",
      planId: plan.id,
      interval: input.interval,
      requestedBy: input.userId,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });

    await audit(input.businessId, "subscription_checkout_started", { planId: plan.id, interval: input.interval, environment: input.environment }, input.userId);
    return { clientSecret: session.client_secret ?? "" };
  } catch (error) {
    return { error: getStripeErrorMessage(error) };
  }
}

export async function createBillingPortalSession(input: {
  businessId: string;
  returnUrl: string;
  environment: StripeEnv;
}): Promise<PortalResult> {
  const state = await getSubscriptionForBusiness(input.businessId);
  if (!state.stripeCustomerId) return { error: "No billing account yet — choose a plan first." };
  try {
    const stripe = createStripeClient(input.environment);
    const portal = await stripe.billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      return_url: input.returnUrl,
    });
    return { url: portal.url };
  } catch (error) {
    return { error: getStripeErrorMessage(error) };
  }
}

/* ------------------------------------------------------------------ webhooks */

function toStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "preview"; // incomplete / paused: not entitled yet
  }
}

async function planFromPrice(price: any): Promise<{ planId: string; interval: BillingInterval } | null> {
  const key: string | null = price?.lookup_key ?? price?.metadata?.lovable_external_id ?? null;
  if (!key) return null;
  // Hidden plans included: a promo-code plan is still the plan that was paid for.
  const plans = await listAllPlans();
  for (const plan of plans) {
    if (plan.stripeMonthlyPriceId === key) return { planId: plan.id, interval: "month" };
    if (plan.stripeAnnualPriceId === key) return { planId: plan.id, interval: "year" };
  }
  return null;
}

const iso = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;

/** checkout.session.completed for a plan purchase. */
export async function handleSubscriptionSession(session: any, env: StripeEnv) {
  const businessId: string | undefined = session.metadata?.bookedsecureBusinessId;
  if (!businessId) return { ok: false as const, detail: "Subscription session without business" };
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

  if (customerId) await applySubscriptionState(businessId, { stripeCustomerId: customerId });

  if (subscriptionId) {
    try {
      // Read the subscription's real state before linking it: a session that is
      // replayed after the subscription was cancelled must not touch access.
      const stripe = createStripeClient(env);
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return await syncSubscription(subscription, businessId);
    } catch (error) {
      console.error("[subscription] retrieve after checkout failed:", getStripeErrorMessage(error));
    }
  }

  const current = await getSubscriptionForBusiness(businessId);
  if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscriptionId) {
    return { ok: true as const, detail: "Ignored checkout for a business already subscribed" };
  }
  const wasActive = current.status === "active";
  await applySubscriptionState(businessId, {
    status: "active",
    stripeSubscriptionId: subscriptionId ?? null,
    planId: session.metadata?.planId,
    interval: session.metadata?.interval === "year" ? "year" : "month",
    pastDueSince: null,
  });
  if (!wasActive) await onActivated(businessId);
  return { ok: true as const, detail: "Subscription activated from checkout" };
}

/** customer.subscription.created / updated / deleted. */
export async function syncSubscription(subscription: any, knownBusinessId?: string) {
  const businessId =
    knownBusinessId ??
    subscription.metadata?.bookedsecureBusinessId ??
    (await findBusinessByStripeSubscription(subscription.id)) ??
    (typeof subscription.customer === "string" ? await findBusinessByStripeCustomer(subscription.customer) : null);
  if (!businessId) return { ok: false as const, detail: "Subscription not linked to a business" };

  // Ignore stale events for a subscription that has since been replaced.
  const current = await getSubscriptionForBusiness(businessId);
  if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id && current.status !== "canceled") {
    return { ok: true as const, detail: "Ignored event for superseded subscription" };
  }

  const item = subscription.items?.data?.[0];
  const resolved = await planFromPrice(item?.price);
  const status = toStatus(subscription.status);
  const wasFull = current.status === "active";

  // A subscription this business was never linked to can only ever grant
  // access, never take it away: a cancelled or incomplete stranger must not
  // downgrade a business that is active on other terms.
  const isLinked = current.stripeSubscriptionId === subscription.id;
  if (!isLinked && status !== "active" && status !== "past_due") {
    return { ok: true as const, detail: `Ignored ${subscription.status} event for an unlinked subscription` };
  }

  await applySubscriptionState(businessId, {
    status,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : current.stripeCustomerId,
    ...(resolved ?? {}),
    currentPeriodStart: iso(item?.current_period_start ?? subscription.current_period_start),
    currentPeriodEnd: iso(item?.current_period_end ?? subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    pastDueSince: status === "past_due" ? current.pastDueSince ?? new Date().toISOString() : null,
  });

  await audit(businessId, "subscription_synced", {
    stripeStatus: subscription.status,
    status,
    planId: resolved?.planId ?? current.planId,
    interval: resolved?.interval ?? current.interval,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });

  if (status === "active" && !wasFull) await onActivated(businessId);

  // Cancelled while previously active: return their number to the pool so
  // another tenant can claim it, and stop their texts at the source. A recall
  // failure must never block the billing sync — it's retried on the next
  // number-pool sync.
  if (status === "canceled" && wasFull) {
    try {
      const { recallTextoNumber } = await import("@/lib/sms/texto-accounts.server");
      await recallTextoNumber(businessId);
    } catch (error) {
      console.error("[subscription] number release after cancellation failed:", error);
    }
  }
  return { ok: true as const, detail: `Subscription ${subscription.status} → ${status}` };
}

/** invoice.payment_failed for a plan subscription. */
export async function handleSubscriptionInvoiceFailed(invoice: any) {
  const subscriptionId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
  const businessId =
    (typeof subscriptionId === "string" ? await findBusinessByStripeSubscription(subscriptionId) : null) ??
    (typeof invoice.customer === "string" ? await findBusinessByStripeCustomer(invoice.customer) : null);
  if (!businessId) return null;
  const current = await getSubscriptionForBusiness(businessId);
  if (!current.stripeSubscriptionId) return null;
  await applySubscriptionState(businessId, {
    status: "past_due",
    pastDueSince: current.pastDueSince ?? new Date().toISOString(),
  });
  await audit(businessId, "subscription_payment_failed", { invoiceId: invoice.id });
  return { ok: true as const, detail: "Subscription marked past due" };
}

/** invoice.paid for a plan subscription: clears past-due. */
export async function handleSubscriptionInvoicePaid(invoice: any) {
  const subscriptionId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
  const businessId =
    (typeof subscriptionId === "string" ? await findBusinessByStripeSubscription(subscriptionId) : null) ??
    (typeof invoice.customer === "string" ? await findBusinessByStripeCustomer(invoice.customer) : null);
  if (!businessId) return null;
  const current = await getSubscriptionForBusiness(businessId);
  if (!current.stripeSubscriptionId) return null;
  if (current.status === "past_due") {
    await applySubscriptionState(businessId, { status: "active", pastDueSince: null });
    await audit(businessId, "subscription_payment_recovered", { invoiceId: invoice.id });
  }

  // Book the provider's share of this payment (the tenant's number for the
  // month) and remember what they paid, so cost and margin stay truthful.
  // Idempotent on the invoice id: a redelivered event books nothing new.
  try {
    const { settleSubscriptionInvoice } = await import("@/lib/provider-costs.server");
    const paidCents = Number(invoice.amount_paid ?? invoice.total ?? 0);
    await settleSubscriptionInvoice({
      businessId,
      invoiceId: String(invoice.id),
      amountPaidCents: Number.isFinite(paidCents) ? paidCents : 0,
      ...(typeof invoice.created === "number" ? { at: new Date(invoice.created * 1000) } : {}),
    });
  } catch (error) {
    console.error("[subscription] provider cost bookkeeping failed:", error);
  }

  // Every paid invoice re-runs provisioning. Idempotent: a tenant that already
  // has an active number is a no-op, while one that was queued (provider had no
  // stock, no saved card, etc.) gets its number bought automatically on the
  // next payment instead of waiting for a human.
  try {
    await provisionMessagingForBusiness(businessId);
  } catch (error) {
    console.error("[subscription] provisioning retry on invoice.paid failed:", error);
  }

  return { ok: true as const, detail: "Subscription invoice paid" };
}

/** First activation: make sure the tenant has a messaging account to send from. */
/**
 * First activation of a paid plan: give the tenant its dedicated number.
 * Re-runs safely — an account that is already active with a number is a
 * no-op, and a queued/failed one is retried. The previous sender is only
 * switched off inside provisioning once a Texto number is actually assigned,
 * so a tenant keeps sending on its old number until the new one is real.
 */
export async function provisionMessagingForBusiness(businessId: string) {
  const { provisionTextoAccount } = await import("@/lib/sms/texto-accounts.server");
  const [{ data: business }, { data: owner }] = await Promise.all([
    supabaseAdmin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  return provisionTextoAccount({
    businessId,
    businessName: business?.name ?? "New business",
    ownerEmail: owner?.email ?? "",
    // Included SMS allowance is metered from the subscription period, not
    // from Texto credits, so no seed credits are allocated here.
    startingCredits: 0,
  });
}

async function onActivated(businessId: string) {
  try {
    const result = await provisionMessagingForBusiness(businessId);
    await audit(businessId, "subscription_activation_provisioning", {
      ok: result.ok,
      state: result.account.provisioning_state,
      ...(result.ok ? { number: result.number.number } : { reason: result.reason, queued: result.queued }),
    });
  } catch (error) {
    console.error("[subscription] messaging provisioning failed:", error);
  }
  await audit(businessId, "subscription_activated", {});
}
