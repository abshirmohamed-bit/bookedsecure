import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_STATUSES } from "@/lib/domain";
import { OWNER_ASSISTANT_MAX_QUESTION, normaliseOwnerQuestion } from "@/lib/owner-assistant";

/**
 * One owner request from the assistant. The tool-using assistant reads and
 * changes this tenant's records directly; texts, campaigns and imports come
 * back as proposals the owner confirms on screen.
 */
export const runOwnerRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      question: z.string().max(OWNER_ASSISTANT_MAX_QUESTION * 2),
      threadId: z.string().uuid(),
      attachment: z
        .object({
          filename: z.string().min(1).max(200),
          content: z.string().max(2 * 1024 * 1024),
        })
        .nullable()
        .optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { handleOwnerRequest } = await import("@/lib/owner-actions.server");
    const { loadAssistantThread, persistOwnerExchange } = await import(
      "@/lib/assistant-history.server"
    );
    const app = await requireAppContext(context.supabase, context.userId);
    const attachment = data.attachment ?? null;
    const typed = normaliseOwnerQuestion(data.question);
    const question =
      typed.length > 0
        ? typed
        : attachment
          ? `Please check and import the contacts in ${attachment.filename}.`
          : "";

    // The assistant needs the conversation so far to follow "book her in too".
    const prior = await loadAssistantThread({
      businessId: app.businessId,
      threadId: data.threadId,
    });

    const result = await handleOwnerRequest({
      businessId: app.businessId,
      userId: app.userId,
      role: app.role,
      question,
      history: prior.messages
        .filter((message) => message.text.trim().length > 0)
        .map((message) => ({ role: message.role, text: message.text })),
      attachment,
    });
    const done = result.executed.length > 0 ? result.executed.join(" ") : null;
    const saved = await persistOwnerExchange({
      businessId: app.businessId,
      threadId: data.threadId,
      question: attachment ? `${question} (attached ${attachment.filename})` : question,
      answer: result.answer,
      proposals: result.proposals,
      done,
    });
    return { ...result, done, assistantMessageId: saved.assistantMessageId };
  });

/** Sends one text the owner has just confirmed on screen. Consent, quiet hours, credits and caps still apply. */
export const confirmAssistantText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), message: z.string().min(2).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { sendSms } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    const result = await sendSms({
      businessId: app.businessId,
      leadId: data.leadId,
      body: data.message,
      kind: "manual",
      respectAutomation: false,
      userId: app.userId,
      source: "manual",
    });
    if (!result.sent) throw new Error(result.reason ?? "That text was not sent.");
    return { sent: true };
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
