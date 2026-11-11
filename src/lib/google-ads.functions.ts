import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function owner(context: { supabase: never; userId: string }) {
  const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

/** Google Ads results: spend and clicks from Google, leads to revenue from BookedSecure. */
export const getGoogleAdPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await owner(context as never);
    const { googleAdPerformance } = await import("@/lib/google-ads.server");
    return googleAdPerformance(ctx.businessId, data.days);
  });

/** Where to send the owner to sign in to Google Ads. */
export const startGoogleAdsConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await owner(context as never);
    const { googleAdsLoginUrl } = await import("@/lib/google-ads.server");
    return { url: googleAdsLoginUrl(ctx.businessId, ctx.userId) };
  });

export const chooseGoogleAdsAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ customerId: z.string().regex(/^\d{6,12}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await owner(context as never);
    const { chooseGoogleAdsAccount, syncGoogleAdSpend } = await import("@/lib/google-ads.server");
    const pick = await chooseGoogleAdsAccount(ctx.businessId, data.customerId);
    await syncGoogleAdSpend(ctx.businessId).catch(() => undefined);
    return pick;
  });

export const syncGoogleAdsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await owner(context as never);
    const { syncGoogleAdSpend } = await import("@/lib/google-ads.server");
    try { return { ok: true as const, ...(await syncGoogleAdSpend(ctx.businessId)) }; }
    catch (e) { return { ok: false as const, reason: e instanceof Error ? e.message : "Google Ads figures could not be loaded." }; }
  });

export const disconnectGoogleAdsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await owner(context as never);
    const { disconnectGoogleAds } = await import("@/lib/google-ads.server");
    return disconnectGoogleAds(ctx.businessId, ctx.userId);
  });
