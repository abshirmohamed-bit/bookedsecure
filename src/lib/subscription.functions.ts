/**
 * Subscription & billing server functions for the signed-in tenant.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Plan } from "@/lib/plans";
import type { PromoEntitlement } from "@/lib/promo";
import type { CreditPack } from "@/lib/sms/credit-packs";
import type { AccessLevel, SubscriptionState } from "@/lib/subscription";

export type MyBilling = {
  plan: Plan;
  plans: Plan[];
  /** The credit packs this business may buy, at the price it pays. */
  packs: CreditPack[];
  /** Promo pricing this business has redeemed, if any. */
  promo: PromoEntitlement;
  subscription: SubscriptionState;
  access: AccessLevel;
  role: "owner" | "staff" | "platform_admin";
  usage: {
    includedSegments: number;
    segmentsUsed: number;
    periodEnd: string;
  } | null;
  creditBalance: number;
  activeMembers: number;
};

const CheckoutSchema = z.object({
  planId: z.string().min(1).max(40),
  interval: z.enum(["month", "year"]),
  environment: z.enum(["sandbox", "live"]),
  returnPath: z.string().max(200).optional(),
});

const PortalSchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  returnPath: z.string().max(200).optional(),
});

function safePath(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

/** Everything the shell, billing page and upgrade dialog need in one read. */
export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyBilling> => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { getPlanForBusiness, listPlansForBusiness } = await import("@/lib/plans.server");
    const { getSubscriptionForBusiness, getUsageSummary } = await import("@/lib/subscription.server");
    const { accessLevel } = await import("@/lib/subscription");
    const { getTextoAccount } = await import("@/lib/sms/texto-accounts.server");
    const { resolvePromoEntitlement } = await import("@/lib/promo.server");
    const { packsFor } = await import("@/lib/sms/credit-packs");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const app = await requireAppContext(context.supabase, context.userId);
    const [plan, plans, promo, subscription, usage, account, members] = await Promise.all([
      getPlanForBusiness(app.businessId),
      listPlansForBusiness(app.businessId),
      resolvePromoEntitlement(app.businessId),
      getSubscriptionForBusiness(app.businessId),
      getUsageSummary(app.businessId),
      getTextoAccount(app.businessId),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("business_id", app.businessId)
        .eq("active", true),
    ]);

    return {
      plan,
      plans,
      packs: [...packsFor(promo.creditPackSet)],
      promo,
      subscription,
      access: accessLevel(subscription),
      role: app.role,
      usage: usage
        ? { includedSegments: usage.includedSegments, segmentsUsed: usage.segmentsUsed, periodEnd: usage.periodEnd }
        : null,
      creditBalance: account?.credit_balance ?? 0,
      activeMembers: members.count ?? 0,
    };
  });

/** Owner-only: open an embedded checkout for a plan. */
export const startSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CheckoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { createSubscriptionCheckout } = await import("@/lib/subscription-billing.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
    const path = safePath(data.returnPath, "/settings/billing");
    const joiner = path.includes("?") ? "&" : "?";
    return await createSubscriptionCheckout({
      businessId: app.businessId,
      userId: app.userId,
      email: app.email,
      planId: data.planId,
      interval: data.interval,
      environment: data.environment,
      returnUrl: `${origin}${path}${joiner}checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
    });
  });

/** Owner-only: apply a promo code to this business, for life. */
export const applyPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; code: string } | { error: string }> => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { redeemPromoCode } = await import("@/lib/promo.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const result = await redeemPromoCode({ businessId: app.businessId, userId: app.userId, code: data.code });
    if (!result.ok) return { error: result.error };
    return { ok: true, code: result.entitlement.code ?? data.code };
  });

/** Owner-only: Stripe's hosted portal for card, plan changes and cancellation. */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PortalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { createBillingPortalSession } = await import("@/lib/subscription-billing.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
    return await createBillingPortalSession({
      businessId: app.businessId,
      environment: data.environment,
      returnUrl: `${origin}${safePath(data.returnPath, "/settings/billing")}`,
    });
  });
