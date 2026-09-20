/**
 * Onboarding journey: request layer. The business is always resolved from the
 * signed-in user's own profile, so one tenant can never read or change another.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOnboardingProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { readOnboardingSnapshot } = await import("@/lib/onboarding.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await readOnboardingSnapshot(app);
  });

export const saveBusinessTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ trade: z.string().min(2).max(40) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { saveTrade } = await import("@/lib/onboarding.server");
    // Deliberately not behind the paywall: choosing a trade is part of setting
    // up, which happens before the subscription starts.
    const app = await requireAppContext(context.supabase, context.userId);
    return await saveTrade(app, data.trade);
  });

/**
 * Records where this business came from (ad campaign, partner link), once.
 * Written only when it is still empty, so a later visit from another link can
 * never overwrite the original attribution.
 */
export const recordSignupSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        source: z.string().max(120).nullable().optional(),
        ref: z.string().max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    if (!data.source && !data.ref) return { ok: true as const, stored: false };

    const { data: existing } = await supabaseAdmin
      .from("businesses")
      .select("signup_source, signup_ref")
      .eq("id", app.businessId)
      .maybeSingle();
    if (existing?.signup_source || existing?.signup_ref) return { ok: true as const, stored: false };

    await supabaseAdmin
      .from("businesses")
      .update({ signup_source: data.source ?? null, signup_ref: data.ref ?? null })
      .eq("id", app.businessId);
    return { ok: true as const, stored: true };
  });
