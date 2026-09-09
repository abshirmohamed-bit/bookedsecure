import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CheckoutSchema = z.object({
  applicationId: z.string().uuid(),
  returnPath: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9\-._~/?=&%]*$/, "Invalid return path")
    .default("/admin/pilot-applications"),
});

/**
 * Create the paid-pilot checkout session for one approved application.
 * Platform-admin only; returns a checkout client secret and never any
 * Stripe secret, customer PII or provider credential.
 */
export const createPilotCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CheckoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    const { createPilotCheckout } = await import("@/lib/billing.server");
    const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.lovable.app";
    const result = await createPilotCheckout({
      applicationId: data.applicationId,
      adminUserId: context.userId,
      returnUrl: `${origin}${data.returnPath}?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
    });

    if ("error" in result) return { error: result.error };
    if (!result.clientSecret) return { error: "Stripe did not return a checkout session." };
    return { clientSecret: result.clientSecret, sessionId: result.sessionId };
  });

/**
 * The commercial terms new pilots are invited under, read from the single
 * configuration row so no screen has to hardcode a price or allowance.
 */
export const getPilotTerms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    const { getCommercialConfig } = await import("@/lib/commercial.server");
    const config = await getCommercialConfig();
    return {
      currency: config.currency,
      priceMinorUnits: config.pilotPriceMinorUnits,
      billingInterval: config.billingInterval,
      includedSmsSegments: config.includedSmsSegments,
      pilotDurationDays: config.pilotDurationDays,
      configurationVersion: config.configurationVersion,
    };
  });
