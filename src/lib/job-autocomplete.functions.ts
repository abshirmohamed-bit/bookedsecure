import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAutoCompleteJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { getAutoCompleteSetting } = await import("@/lib/job-autocomplete.server");
    return { ...(await getAutoCompleteSetting(ctx.businessId)), isOwner: ctx.role !== "staff" };
  });

export const setAutoCompleteJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    requireOwner(ctx);
    const { setAutoCompleteSetting } = await import("@/lib/job-autocomplete.server");
    await setAutoCompleteSetting(ctx.businessId, ctx.userId, data.enabled);
    return { ok: true };
  });
