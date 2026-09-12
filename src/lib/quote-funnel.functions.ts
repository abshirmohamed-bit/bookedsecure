import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Public: records that a tenant's quote page was opened, with ad attribution. */
export const recordQuotePageOpened = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(1).max(60),
        url: z.string().max(500),
        referrer: z.string().max(500).optional().nullable(),
        session_key: z.string().max(80).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readAttribution } = await import("@/lib/quote-funnel");
    const { recordQuotePageOpen } = await import("@/lib/quote-funnel.server");
    try {
      return await recordQuotePageOpen({
        slug: data.slug,
        sessionKey: data.session_key ?? null,
        attribution: readAttribution({ url: data.url, referrer: data.referrer ?? null }),
      });
    } catch {
      // Measurement is never allowed to break the conversation.
      return { ok: false as const };
    }
  });

/** Funnel for the signed-in tenant. */
export const getQuoteFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { loadQuoteFunnel } = await import("@/lib/quote-funnel.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await loadQuoteFunnel(app.businessId, data.days ?? 30);
  });

/** Partial prospects for the signed-in tenant. Read-only by design. */
export const getUnfinishedProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { loadUnfinishedProspects } = await import("@/lib/quote-funnel.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const prospects = await loadUnfinishedProspects(app.businessId, data.days ?? 90);
    return { prospects };
  });

/** Removes unfinished prospects (test runs, junk) from the signed-in tenant's list. */
export const deleteUnfinishedProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationIds: z.array(z.string().uuid()).min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { deleteUnfinishedConversations } = await import("@/lib/quote-funnel.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await deleteUnfinishedConversations({
      businessId: app.businessId,
      userId: context.userId,
      conversationIds: data.conversationIds,
    });
  });
