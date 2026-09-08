import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UrlSchema = z.object({ url: z.string().min(4).max(300) });

const WindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const ProposalSchema = z.object({
  sourceUrl: z.string().max(300),
  business: z.object({
    name: z.string().max(80).nullable(),
    service_area: z.string().max(300).nullable(),
    opening_hours: z.string().max(200).nullable(),
    phone_number: z.string().max(20).nullable(),
  }),
  logoUrl: z.string().max(500).nullable(),
  services: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        description: z.string().max(600).nullable(),
        price_guidance: z.string().max(200).nullable(),
        duration_minutes: z.number().int().min(15).max(1440),
      }),
    )
    .max(20),
  weeklyWindows: z.array(WindowSchema).max(21),
  warnings: z.array(z.string().max(300)).max(20),
});

/** Read-only: reads the tenant's own website and proposes their setup. */
export const readTenantSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UrlSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { previewSiteOnboarding } = await import("@/lib/site-onboarding.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return previewSiteOnboarding(app, data.url);
  });

/** Owner-approved save of the proposal produced above. */
export const applyTenantSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProposalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { applySiteOnboarding } = await import("@/lib/site-onboarding.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return applySiteOnboarding(app, data);
  });
