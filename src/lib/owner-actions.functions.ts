import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_STATUSES } from "@/lib/domain";
import { OWNER_ASSISTANT_MAX_QUESTION, normaliseOwnerQuestion } from "@/lib/owner-assistant";

/**
 * One owner request from the home page. Reads answer the question; action
 * requests only PREPARE work (draft rows, counts) for the owner to confirm.
 */
export const runOwnerRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().max(OWNER_ASSISTANT_MAX_QUESTION * 2) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { handleOwnerRequest } = await import("@/lib/owner-actions.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return handleOwnerRequest({
      businessId: app.businessId,
      userId: app.userId,
      question: normaliseOwnerQuestion(data.question),
    });
  });

/** Applies a status change the owner has just confirmed on screen. */
export const confirmOwnerStatusChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.enum(LEAD_STATUSES).nullable(),
        to: z.enum(LEAD_STATUSES),
        maxLeads: z.number().int().min(1).max(2000).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { applyStatusChange } = await import("@/lib/owner-actions.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return applyStatusChange({
      businessId: app.businessId,
      userId: app.userId,
      from: data.from,
      to: data.to,
      maxLeads: data.maxLeads,
    });
  });

/** Applies an add-on linking change the owner has just confirmed on screen. */
export const confirmAddonLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        addonId: z.string().uuid(),
        serviceIds: z.array(z.string().uuid()).min(1).max(200),
        remove: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { applyAddonLinks } = await import("@/lib/catalog-actions.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return applyAddonLinks({
      businessId: app.businessId,
      userId: app.userId,
      addonId: data.addonId,
      serviceIds: data.serviceIds,
      remove: data.remove,
    });
  });
