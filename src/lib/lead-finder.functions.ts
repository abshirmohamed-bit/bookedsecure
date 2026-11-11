import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function member(context: { supabase: any; userId: string }) {
  const { requireAppContext } = await import("./app-context.server");
  return requireAppContext(context.supabase, context.userId);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function owner(context: { supabase: any; userId: string }) {
  const { requireWriteContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireWriteContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

export const getLeadFinder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ searchId: z.string().uuid().nullable().default(null) }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { leadFinderState } = await import("./lead-finder.server");
    return { ...(await leadFinderState(ctx.businessId, data.searchId)), isOwner: ctx.role !== "staff" };
  });

export const runLeadFinderSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    what: z.string().trim().min(3).max(120),
    where: z.string().trim().min(2).max(80),
    criteria: z.string().trim().max(400).nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { runLeadSearch } = await import("./lead-finder.server");
    return runLeadSearch({ businessId: ctx.businessId, userId: ctx.userId, ...data });
  });

export const addLeadFinderResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { addFoundToCustomers } = await import("./lead-finder.server");
    return addFoundToCustomers(ctx.businessId, ctx.userId, data.ids);
  });

export const dismissLeadFinderResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { dismissFound } = await import("./lead-finder.server");
    await dismissFound(ctx.businessId, data.ids);
    return { ok: true };
  });

/** Co-Work's suggested searches for this business (nothing is searched yet). */
export const suggestLeadFinderSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ request: z.string().trim().max(500).nullable().default(null), likeLeadId: z.string().uuid().nullable().default(null) }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { suggestLeadSearches } = await import("./lead-finder.server");
    return { suggestions: await suggestLeadSearches(ctx.businessId, data.request, data.likeLeadId) };
  });
