import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ThreadSchema = z.object({ threadId: z.string().uuid() });

async function appContext(context: Parameters<Parameters<typeof requireSupabaseAuth>[0]>[0]) {
  const { requireAppContext } = await import("@/lib/app-context.server");
  return requireAppContext(context.supabase, context.userId);
}

export const getAssistantHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getOrCreateDefaultAssistantThread, listAssistantThreads } = await import("@/lib/assistant-history.server");
    const app = await appContext(context);
    const ongoing = await getOrCreateDefaultAssistantThread({ businessId: app.businessId, userId: app.userId });
    return { ongoing, threads: await listAssistantThreads(app.businessId) };
  });

export const getAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { loadAssistantThread, listAssistantThreads } = await import("@/lib/assistant-history.server");
    const app = await appContext(context);
    return {
      ...(await loadAssistantThread({ businessId: app.businessId, threadId: data.threadId })),
      threads: await listAssistantThreads(app.businessId),
    };
  });

export const createAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { createAssistantThread } = await import("@/lib/assistant-history.server");
    const app = await appContext(context);
    return createAssistantThread({ businessId: app.businessId, userId: app.userId });
  });

export const deleteAssistantConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThreadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { archiveAssistantThread, getOrCreateDefaultAssistantThread } = await import("@/lib/assistant-history.server");
    const app = await appContext(context);
    await archiveAssistantThread({ businessId: app.businessId, threadId: data.threadId });
    return getOrCreateDefaultAssistantThread({ businessId: app.businessId, userId: app.userId });
  });

export const completeAssistantMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ messageId: z.string().uuid(), done: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { completeAssistantProposal } = await import("@/lib/assistant-history.server");
    const app = await appContext(context);
    await completeAssistantProposal({ businessId: app.businessId, messageId: data.messageId, done: data.done });
    return { ok: true };
  });