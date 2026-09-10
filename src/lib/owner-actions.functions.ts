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
    z.object({
      question: z.string().max(OWNER_ASSISTANT_MAX_QUESTION * 2),
      threadId: z.string().uuid(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { handleOwnerRequest } = await import("@/lib/owner-actions.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const result = await handleOwnerRequest({
      businessId: app.businessId,
      userId: app.userId,
      question: normaliseOwnerQuestion(data.question),
    });
    const { persistOwnerExchange } = await import("@/lib/assistant-history.server");
    await persistOwnerExchange({
      businessId: app.businessId,
      threadId: data.threadId,
      question: normaliseOwnerQuestion(data.question),
      answer: result.answer,
      proposals: result.proposals,
    });
    return result;
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

/** Applies a single-customer update the owner has just confirmed on screen. */
export const confirmLeadUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        details: z
          .object({
            mobile_number: z.string().min(6).max(20).optional(),
            email: z.string().email().max(200).optional(),
            suburb: z.string().min(2).max(80).optional(),
            vehicle_type: z.string().min(2).max(80).optional(),
            service_intent: z.string().min(2).max(120).optional(),
          })
          .default({}),
        markCompleted: z.boolean(),
        paidAmount: z.number().positive().max(1_000_000).nullable(),
        bookAt: z.string().datetime().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { applyLeadUpdate } = await import("@/lib/owner-lead-actions.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return applyLeadUpdate({
      businessId: app.businessId,
      userId: app.userId,
      leadId: data.leadId,
      // Drop keys the owner did not state, so nothing is blanked out.
      details: Object.fromEntries(
        Object.entries(data.details).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>,
      markCompleted: data.markCompleted,
      paidAmount: data.paidAmount,
      bookAt: data.bookAt,
    });
  });
