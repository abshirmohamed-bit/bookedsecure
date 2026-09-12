import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ThreadSchema = z.object({ threadId: z.string().uuid() });

export const getAssistantHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getOrCreateDefaultAssistantThread, listAssistantThreads } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const ongoing = await getOrCreateDefaultAssistantThread({ businessId: app.businessId, userId: app.userId });
    return { ongoing, threads: await listAssistantThreads(app.businessId) };
  });

export const getAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { loadAssistantThread, listAssistantThreads } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return {
      ...(await loadAssistantThread({ businessId: app.businessId, threadId: data.threadId })),
      threads: await listAssistantThreads(app.businessId),
    };
  });

export const createAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { createAssistantThread } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return createAssistantThread({ businessId: app.businessId, userId: app.userId });
  });

export const deleteAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { archiveAssistantThread, getOrCreateDefaultAssistantThread } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await archiveAssistantThread({ businessId: app.businessId, threadId: data.threadId });
    return getOrCreateDefaultAssistantThread({ businessId: app.businessId, userId: app.userId });
  });

export const clearAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { clearAssistantThread } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await clearAssistantThread({ businessId: app.businessId, threadId: data.threadId });
    return { ok: true };
  });

export const completeAssistantMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ messageId: z.string().uuid(), done: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { completeAssistantProposal } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await completeAssistantProposal({ businessId: app.businessId, messageId: data.messageId, done: data.done });
    return { ok: true };
  });
/** The file this conversation still remembers, so the owner need not upload it again. */
export const getAssistantRememberedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { latestAssistantFile } = await import("@/lib/assistant-history.server");
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const file = await latestAssistantFile({ businessId: app.businessId, threadId: data.threadId });
    return file ? { filename: file.filename, createdAt: file.createdAt } : null;
  });
