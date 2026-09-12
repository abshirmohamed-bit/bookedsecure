/**
 * Server-side paid-pilot billing (Slice 2).
 *
 * Responsibilities:
 *  - create a Stripe checkout session for exactly one approved application
 *  - process verified webhook events idempotently (stripe_events is the ledger)
 *  - run the 30-day expiry job
 *
 * Deliberately out of scope: tenants, phone numbers, provider credentials and
 * any messaging activity. Access to live sending is decided elsewhere by
 * `authorizeLiveSend`, which reads the state this module writes.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  effectivePilotEnd,
  snapshotTerms,
  MESSAGING_ELIGIBLE_STATES,
  type CommercialTermsSnapshot,
} from "@/lib/commercial";

import {
  assertCheckoutEligible,
  confirmRenewalPrevention,
  pilotWindowFromPayment,
  resolveCancellationState,
  shouldExpire,
  shouldStartPilot,
  validatePaymentFacts,
  type BillingApplication,
} from "@/lib/billing";

import { getCommercialConfig, freezeTermsForApplication } from "@/lib/commercial.server";
import { auditPilotEvent } from "@/lib/pilot.server";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { provisionTextoAccount } from "@/lib/sms/texto-accounts.server";

/**
 * The pilot programme runs in Stripe test mode only. Going live is a separate,
 * explicit commercial decision — never inferred from the environment.
 */
export function pilotStripeEnv(): StripeEnv {
  return "sandbox";
}

type Row = Database["public"]["Tables"]["pilot_applications"]["Row"];

const BILLING_COLUMNS =
  "id, status, cancellation_requested_at, access_state, business_id, email, business_name, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, pilot_started_at, pilot_ends_at, pilot_extension_ends_at, commercial_terms_snapshot, payment_required";

function toBilling(row: Partial<Row> & { id: string }): BillingApplication {
  return {
    id: row.id,
    status: (row.status ?? "pending") as string,
    accessState: (row.access_state ?? "pending") as BillingApplication["accessState"],
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    pilotStartedAt: row.pilot_started_at ?? null,
    pilotEndsAt: row.pilot_ends_at ?? null,
    pilotExtensionEndsAt: row.pilot_extension_ends_at ?? null,
  };
}

async function loadApplication(id: string) {
  const { data, error } = await supabaseAdmin
    .from("pilot_applications")
    .select(BILLING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function findApplicationByStripe(filters: {
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
  customerId?: string | null;
}) {
  const attempts: Array<[keyof Row, string]> = [];
  if (filters.checkoutSessionId)
    attempts.push(["stripe_checkout_session_id", filters.checkoutSessionId]);
  if (filters.subscriptionId) attempts.push(["stripe_subscription_id", filters.subscriptionId]);
  if (filters.customerId) attempts.push(["stripe_customer_id", filters.customerId]);

  for (const [column, value] of attempts) {
    const { data } = await supabaseAdmin
      .from("pilot_applications")
      .select(BILLING_COLUMNS)
      .eq(column as string, value)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/* ------------------------------------------------------------------ checkout */

export type CheckoutResult = { clientSecret: string; sessionId: string } | { error: string };

/**
 * Create a one-quantity AUD $99/month checkout session for a single approved
 * application. Platform-admin authorisation happens in the calling server
 * function; this helper re-validates eligibility against the database.
 */
export async function createPilotCheckout(input: {
  applicationId: string;
  adminUserId: string;
  returnUrl: string;
}): Promise<CheckoutResult> {
  const row = await loadApplication(input.applicationId);
  if (!row) return { error: "Application not found." };

  const app = toBilling(row);
  const eligible = assertCheckoutEligible(app);
  if (!eligible.ok) return { error: eligible.error };

  const config = await getCommercialConfig();
  if (!config.stripeRecurringPriceId) {
    return { error: "The pilot price is not configured." };
  }

  // Freeze the terms this application is being sold under before payment, so
  // the webhook can validate the settled amount against an immutable record.
  const snapshot: CommercialTermsSnapshot =
    (row.commercial_terms_snapshot as CommercialTermsSnapshot | null) ??
    (await freezeTermsForApplication(app.id, config));

  try {
    const stripe = createStripeClient(pilotStripeEnv());

    const prices = await stripe.prices.list({ lookup_keys: [config.stripeRecurringPriceId] });
    const price = prices.data[0];
    if (!price) return { error: "The pilot price could not be found in Stripe." };
    if ((price.currency ?? "").toLowerCase() !== config.currency.toLowerCase()) {
      return { error: "The configured pilot price is not in the expected currency." };
    }
    if (price.unit_amount !== config.pilotPriceMinorUnits) {
      return { error: "The configured pilot price amount does not match the commercial terms." };
    }

    // Customer carries the application id so every later Stripe read resolves.
    let customerId = row.stripe_customer_id ?? null;
    if (!customerId) {
      const found = await stripe.customers.search({
        query: `metadata['pilotApplicationId']:'${app.id}'`,
        limit: 1,
      });
      customerId =
        found.data[0]?.id ??
        (
          await stripe.customers.create({
            email: row.email ?? undefined,
            name: row.business_name ?? undefined,
            metadata: { pilotApplicationId: app.id },
          })
        ).id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      // No trial, no discounts, no overage, no quantity editing.
      allow_promotion_codes: false,
      metadata: { pilotApplicationId: app.id, programme: "bookedsecure_paid_pilot" },
      subscription_data: {
        metadata: { pilotApplicationId: app.id, programme: "bookedsecure_paid_pilot" },
      },
    });

    await supabaseAdmin
      .from("pilot_applications")
      .update({
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        payment_required: true,
        payment_invited_at: new Date().toISOString(),
        commercial_status: "invited",
      })
      .eq("id", app.id);

    await auditPilotEvent({
      userId: input.adminUserId,
      eventType: "pilot_checkout_created",
      applicationId: app.id,
      metadata: {
        stripe_checkout_session_id: session.id,
        stripe_customer_id: customerId,
        currency: snapshot.currency,
        amount_minor_units: snapshot.pilotPriceMinorUnits,
        environment: pilotStripeEnv(),
      },
    });

    return { clientSecret: session.client_secret ?? "", sessionId: session.id };
  } catch (error) {
    return { error: getStripeErrorMessage(error) };
  }
}

/* ------------------------------------------------------------------ webhooks */

type StripeEventLike = { id: string; type: string; created: number; data: { object: any } };

/**
 * Record the event and claim it for processing. Returns false when this event
 * id was already stored, which makes redelivery a no-op.
 */
async function claimEvent(event: StripeEventLike): Promise<boolean> {
  const { error } = await supabaseAdmin.from("stripe_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    processing_status: "received",
    payload_reference: {
      object_id: event.data?.object?.id ?? null,
      object_type: event.data?.object?.object ?? null,
      created: event.created,
    } as never,
  });
  if (error) {
    // Unique violation on stripe_event_id → duplicate delivery.
    if (error.code === "23505" || error.code === "23505" || /duplicate/i.test(error.message)) {
      return false;
    }
    throw new Error(error.message);
  }
  return true;
}

async function finishEvent(eventId: string, status: string, errorDetail?: string) {
  await supabaseAdmin
    .from("stripe_events")
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      processing_error: errorDetail ?? null,
    })
    .eq("stripe_event_id", eventId);
}

async function termsFor(row: Partial<Row> & { id: string }): Promise<CommercialTermsSnapshot> {
  const existing = row.commercial_terms_snapshot as CommercialTermsSnapshot | null;
  if (existing) return existing;
  const config = await getCommercialConfig();
  return snapshotTerms(config);
}

async function handlePaidSession(session: any, eventCreated: number) {
  const applicationId: string | undefined = session.metadata?.pilotApplicationId;
  const row = applicationId
    ? await loadApplication(applicationId)
    : await findApplicationByStripe({
        checkoutSessionId: session.id,
        customerId: typeof session.customer === "string" ? session.customer : null,
      });
  if (!row) return { ok: false as const, detail: "No matching pilot application" };

  const app = toBilling(row);
  const terms = await termsFor(row);

  const validation = validatePaymentFacts(
    {
      currency: session.currency ?? "",
      amountTotal: session.amount_total ?? null,
      quantity: session.line_items?.data?.[0]?.quantity ?? null,
    },
    terms,
  );
  if (!validation.ok) {
    await auditPilotEvent({
      eventType: "pilot_payment_rejected",
      applicationId: app.id,
      metadata: { reason: validation.error, stripe_checkout_session_id: session.id },
    });
    return { ok: false as const, detail: validation.error };
  }

  if (!shouldStartPilot(app, session.id)) {
    return { ok: true as const, detail: "Pilot already started — no change" };
  }

  const paidAt = new Date(eventCreated * 1000).toISOString();
  const durationDays = terms.pilotDurationDays;
  const window = pilotWindowFromPayment(paidAt, durationDays);

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  const paymentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? session.invoice ?? null);

  await supabaseAdmin
    .from("pilot_applications")
    .update({
      access_state: "paid",
      access_state_reason: "Verified Stripe payment",
      commercial_status: "paid",
      payment_completed_at: paidAt,
      pilot_started_at: window.startedAt,
      pilot_ends_at: window.endsAt,
      stripe_checkout_session_id: session.id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id:
        typeof session.customer === "string" ? session.customer : (row.stripe_customer_id ?? null),
      last_payment_event_at: paidAt,
      commercial_terms_snapshot: terms as never,
      commercial_configuration_version: terms.configurationVersion,
    })
    .eq("id", app.id);

  // Prevent a second automatic charge: the initial period is the whole pilot.
  // Fail closed — the application is only treated as safely non-renewing once
  // Stripe confirms `cancel_at_period_end`, and `hasMessagingAccess` keeps live
  // sending blocked until then.
  let renewalStopped = false;
  let renewalAttempts = 0;
  let renewalError: string | undefined;
  if (subscriptionId) {
    const stripe = createStripeClient(pilotStripeEnv());
    const outcome = await confirmRenewalPrevention({
      subscriptionId,
      applicationId: app.id,
      stripe: {
        update: (id, params) =>
          stripe.subscriptions.update(id, params as never) as unknown as Promise<{
            cancel_at_period_end?: boolean | null;
          }>,
      },
    });
    renewalStopped = outcome.confirmed;
    renewalAttempts = outcome.attempts;
    renewalError = outcome.error;

    await supabaseAdmin
      .from("pilot_applications")
      .update({
        renewal_prevention_confirmed: outcome.confirmed,
        renewal_prevention_attempts: outcome.attempts,
        renewal_prevention_last_attempt_at: new Date().toISOString(),
        renewal_prevention_last_error: outcome.confirmed
          ? null
          : (outcome.error ?? "Stripe did not confirm cancel_at_period_end."),
        ...(outcome.confirmed
          ? {}
          : {
              access_state_reason:
                "Automatic renewal is not confirmed as disabled — live messaging is on hold.",
            }),
      })
      .eq("id", app.id);

    if (!outcome.confirmed) {
      console.error("[billing] renewal prevention unconfirmed:", renewalError);
      await auditPilotEvent({
        eventType: "pilot_renewal_prevention_failed",
        applicationId: app.id,
        metadata: {
          stripe_subscription_id: subscriptionId,
          attempts: outcome.attempts,
          error: renewalError,
          renewal_disabled: false,
          messaging_blocked: true,
        },
      });
    }
  }

  await auditPilotEvent({
    eventType: "pilot_payment_succeeded",
    applicationId: app.id,
    metadata: {
      stripe_checkout_session_id: session.id,
      stripe_subscription_id: subscriptionId,
      stripe_payment_id: paymentId,
      amount_minor_units: session.amount_total,
      currency: session.currency,
      pilot_started_at: window.startedAt,
      pilot_ends_at: window.endsAt,
      renewal_disabled: renewalStopped,
      renewal_prevention_attempts: renewalAttempts,
      renewal_prevention_error: renewalError ?? null,
    },
  });

  // Provision the tenant's Texto sub-account and assign a dedicated number
  // once payment is confirmed. Default mode is simulated until the platform
  // operator explicitly enables live Texto account provisioning.
  if (row.business_id) {
    try {
      const config = await getCommercialConfig();
      await provisionTextoAccount({
        businessId: row.business_id,
        businessName: row.business_name ?? "BookedSecure Business",
        ownerEmail: row.email,
        startingCredits: config.includedSmsSegments,
        dailySendCap: 100,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[billing] Texto provisioning failed for business", row.business_id, detail);
      await auditPilotEvent({
        eventType: "texto_provisioning_hook_failed",
        applicationId: app.id,
        metadata: { business_id: row.business_id, error: detail },
      });
    }
  }

  return { ok: true as const, detail: "Pilot started" };
}

async function handlePaymentFailed(object: any) {
  const subscriptionId =
    typeof object.subscription === "string" ? object.subscription : (object.subscription?.id ?? null);
  const row = await findApplicationByStripe({
    subscriptionId,
    customerId: typeof object.customer === "string" ? object.customer : null,
  });
  if (!row) return { ok: false as const, detail: "No matching pilot application" };

  await supabaseAdmin
    .from("pilot_applications")
    .update({
      access_state: "past_due",
      access_state_reason: "Stripe reported a failed payment",
      commercial_status: "past_due",
      last_payment_event_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  await auditPilotEvent({
    eventType: "pilot_payment_failed",
    applicationId: row.id,
    metadata: { stripe_subscription_id: subscriptionId },
  });
  return { ok: true as const, detail: "Marked past_due" };
}

async function handleSubscriptionCanceled(subscription: any) {
  const row = await findApplicationByStripe({
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : null,
  });
  if (!row) return { ok: false as const, detail: "No matching pilot application" };

  const app = toBilling(row);
  const resolved = resolveCancellationState(app);

  await supabaseAdmin
    .from("pilot_applications")
    .update({
      access_state: resolved.accessState,
      access_state_reason: resolved.reason,
      commercial_status: "canceled",
      cancellation_requested_at:
        (row as { cancellation_requested_at?: string | null }).cancellation_requested_at ??
        new Date().toISOString(),
    })
    .eq("id", row.id);

  await auditPilotEvent({
    eventType: "pilot_subscription_canceled",
    applicationId: row.id,
    metadata: {
      stripe_subscription_id: subscription.id,
      access_state: resolved.accessState,
      access_preserved_until: effectivePilotEnd(app),
    },
  });
  return { ok: true as const, detail: `Cancellation recorded (${resolved.accessState})` };
}

/**
 * Process one verified Stripe event. Storage happens first and is keyed on the
 * Stripe event id, so redelivery has no additional effect.
 */
export async function processStripeEvent(event: StripeEventLike, env: StripeEnv = "sandbox") {
  const claimed = await claimEvent(event);
  if (!claimed) return { received: true, duplicate: true as const, detail: "Already processed" };

  try {
    let detail = `Unhandled event ${event.type}`;
    const sub = await import("@/lib/subscription-billing.server");
    const isPlanSubscription = (obj: any) => obj?.metadata?.bookedsecureSubscription === "true";
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.payment_status === "unpaid") {
          detail = "Payment pending settlement — nothing activated yet";
          break;
        }
        // Credit top-ups are a separate, self-serve purchase: they add SMS
        // credits to one business and never touch pilot or access state.
        if (session.metadata?.creditTopupId) {
          const { handleCreditTopupSession } = await import("@/lib/sms/credit-topups.server");
          detail = (await handleCreditTopupSession(session, event.created)).detail;
          break;
        }
        if (isPlanSubscription(session)) {
          detail = (await sub.handleSubscriptionSession(session, env)).detail;
          break;
        }
        detail = (await handlePaidSession(session, event.created)).detail;
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (isPlanSubscription(event.data.object)) {
          // Re-read the live subscription: Stripe retries and out-of-order
          // deliveries can carry a snapshot that is no longer true.
          let fresh = event.data.object;
          try {
            fresh = await createStripeClient(env).subscriptions.retrieve(event.data.object.id);
          } catch (error) {
            console.error("[stripe-webhook] subscription refetch failed:", getStripeErrorMessage(error));
          }
          detail = (await sub.syncSubscription(fresh)).detail;
        }
        break;
      }
      case "invoice.paid": {
        const handled = await sub.handleSubscriptionInvoicePaid(event.data.object);
        if (handled) detail = handled.detail;
        break;
      }
      case "checkout.session.async_payment_failed":
      case "invoice.payment_failed": {
        const handled =
          event.type === "invoice.payment_failed"
            ? await sub.handleSubscriptionInvoiceFailed(event.data.object)
            : null;
        detail = handled ? handled.detail : (await handlePaymentFailed(event.data.object)).detail;
        break;
      }
      case "customer.subscription.deleted":
        detail = isPlanSubscription(event.data.object)
          ? (await sub.syncSubscription(event.data.object)).detail
          : (await handleSubscriptionCanceled(event.data.object)).detail;
        break;
      default:
        break;
    }
    await finishEvent(event.id, "processed", detail);
    return { received: true, duplicate: false as const, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishEvent(event.id, "failed", message);
    throw error;
  }
}

/* -------------------------------------------------------------------- expiry */

/**
 * Idempotent expiry pass: paid pilots whose effective end date has passed move
 * to the configured end action (`pilot_expired` / `paused`), which immediately
 * blocks live sending. No data is deleted, renewed, converted or provisioned.
 */
export async function processPilotExpiry(now: Date = new Date()) {
  const config = await getCommercialConfig();
  const targetState = config.pilotEndAction === "pause" ? "paused" : "pilot_expired";

  const { data: rows, error } = await supabaseAdmin
    .from("pilot_applications")
    .select(BILLING_COLUMNS)
    .in("access_state", [...MESSAGING_ELIGIBLE_STATES])
    .not("pilot_ends_at", "is", null)
    .lte("pilot_ends_at", now.toISOString())
    .limit(500);

  if (error) throw new Error(error.message);

  const expired: string[] = [];
  for (const row of rows ?? []) {
    const app = toBilling(row);
    if (!shouldExpire(app, now)) continue; // e.g. an admin extension is still running

    const { data: updated } = await supabaseAdmin
      .from("pilot_applications")
      .update({
        access_state: targetState,
        access_state_reason: "Pilot window elapsed",
        commercial_status: "pilot_expired",
      })
      .eq("id", app.id)
      .eq("access_state", app.accessState)
      .select("id")
      .maybeSingle();

    if (updated) {
      expired.push(app.id);
      await auditPilotEvent({
        eventType: "pilot_expired",
        applicationId: app.id,
        metadata: { access_state: targetState, pilot_ends_at: effectivePilotEnd(app) },
      });
    }
  }

  return { checked: rows?.length ?? 0, expired: expired.length, applicationIds: expired };
}
