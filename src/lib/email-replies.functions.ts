import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Customer replies to campaign emails, one conversation per customer per campaign. */
export const getEmailReplyThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { listReplyThreads, inboundRepliesEnabled } = await import("@/lib/email-inbound.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return { ...(await listReplyThreads(app.businessId)), enabled: inboundRepliesEnabled() };
  });

const recipientInput = (input: unknown) => z.object({ recipientId: z.string().uuid() }).parse(input);

export const getEmailReplyThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(recipientInput)
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { getReplyThread, markThreadRead } = await import("@/lib/email-inbound.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const thread = await getReplyThread(app.businessId, data.recipientId);
    await markThreadRead(app.businessId, data.recipientId);
    return thread;
  });

export const sendEmailReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ recipientId: z.string().uuid(), bodyText: z.string().min(1).max(10000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { replyToThread } = await import("@/lib/email-inbound.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return replyToThread({ businessId: app.businessId, recipientId: data.recipientId, bodyText: data.bodyText });
  });
