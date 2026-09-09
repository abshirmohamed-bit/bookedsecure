/**
 * Owner-facing messaging account controls: credit balance, self-serve credit
 * top-ups, pausing sending, and raising a cancellation request.
 *
 * Every function is tenant-scoped to the caller's own business. Buying credits
 * and pausing are owner-only; staff can see the balance but not spend money or
 * change sending state. Nothing here can assign a number or enable live
 * sending — that stays with the platform.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_PACKS } from "@/lib/sms/credit-packs";

const TopupSchema = z.object({ packId: z.string().min(1) });
const PauseSchema = z.object({ paused: z.boolean() });
const CancellationSchema = z.object({ note: z.string().max(1000).optional() });

/**
 * Everything the Messaging screen needs: balance, the business's dedicated
 * number, purchasable packs, recent top-ups and any open request.
 */
export const getMessagingAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);

    const { getTextoAccount, listAssignedNumbers } = await import(
      "@/lib/sms/texto-accounts.server"
    );
    const { listCreditTopups } = await import("@/lib/sms/credit-topups.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { getCommercialConfig, getPilotForBusiness } = await import("@/lib/commercial.server");

    const [account, numbers, topups, businessResult, requestsResult, config, pilot] =
      await Promise.all([
        getTextoAccount(app.businessId),
        listAssignedNumbers(app.businessId),
        listCreditTopups(app.businessId),
        supabaseAdmin
          .from("businesses")
          .select("id, name, automation_enabled")
          .eq("id", app.businessId)
          .maybeSingle(),
        supabaseAdmin
          .from("tenant_requests")
          .select("id, kind, status, note, created_at, resolved_at")
          .eq("business_id", app.businessId)
          .order("created_at", { ascending: false })
          .limit(5),
        getCommercialConfig(),
        getPilotForBusiness(app.businessId),
      ]);

    // Included allowance for the current billing period, from the terms this
    // business was accepted under (never the live config, which may have moved).
    const includedSegments = pilot?.includedSmsSegments ?? config.includedSmsSegments;
    let usedSegments = 0;
    if (pilot) {
      const { data: period } = await supabaseAdmin
        .from("sms_usage_periods")
        .select("segments_used, included_segments, period_end")
        .eq("pilot_application_id", pilot.id)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      usedSegments = period?.segments_used ?? 0;
    }

    return {
      role: app.role,
      business: businessResult.data ?? null,
      plan: {
        currency: config.currency,
        priceMinorUnits: config.pilotPriceMinorUnits,
        billingInterval: config.billingInterval,
        includedSegments,
        usedSegments,
      },
      account: account
        ? {
            creditBalance: account.credit_balance,
            allocatedCredits: account.allocated_credits,
            dailySendCap: account.daily_send_cap,
            provisioningState: account.provisioning_state,
            failedReason: account.failed_reason,
          }
        : null,
      numbers: numbers.map((number) => ({
        id: number.id,
        number: number.number,
        status: number.status,
        assignedAt: number.assigned_at,
        monthlyCostCents: number.monthly_cost_cents,
      })),
      packs: CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        label: pack.label,
        credits: pack.credits,
        amountCents: pack.amountCents,
      })),
      topups,
      requests: requestsResult.data ?? [],
    };
  });

/** Owner-only: start an embedded Stripe checkout for one credit pack. */
export const startCreditTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TopupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);

    const { createCreditTopupCheckout } = await import("@/lib/sms/credit-topups.server");
    const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.lovable.app";
    const result = await createCreditTopupCheckout({
      businessId: app.businessId,
      packId: data.packId,
      userId: app.userId,
      email: app.email,
      returnUrl: `${origin}/settings/messaging?topup=complete&session_id={CHECKOUT_SESSION_ID}`,
    });
    if ("error" in result) return { error: result.error };
    return { clientSecret: result.clientSecret };
  });

/** Owner-only: pause or resume all automated sending for this business. */
export const setMessagingPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PauseSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("businesses")
      .update({ automation_enabled: !data.paused })
      .eq("id", app.businessId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_events").insert({
      business_id: app.businessId,
      user_id: app.userId,
      event_type: data.paused ? "messaging_paused_by_owner" : "messaging_resumed_by_owner",
      entity_type: "business",
      entity_id: app.businessId,
    });

    return { paused: data.paused };
  });

/**
 * Owner-only: raise a cancellation request. Nothing is cancelled, deleted or
 * refunded automatically — the platform releases the number and closes the
 * account after reviewing the request.
 */
export const requestCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CancellationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("tenant_requests")
      .select("id")
      .eq("business_id", app.businessId)
      .eq("kind", "cancellation")
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (existing) return { id: existing.id, alreadyOpen: true as const };

    const { data: row, error } = await supabaseAdmin
      .from("tenant_requests")
      .insert({
        business_id: app.businessId,
        requested_by: app.userId,
        kind: "cancellation",
        note: data.note ?? null,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not raise the request.");

    await supabaseAdmin.from("audit_events").insert({
      business_id: app.businessId,
      user_id: app.userId,
      event_type: "cancellation_requested",
      entity_type: "tenant_request",
      entity_id: row.id,
      metadata: { note: data.note ?? null },
    });

    return { id: row.id, alreadyOpen: false as const };
  });
