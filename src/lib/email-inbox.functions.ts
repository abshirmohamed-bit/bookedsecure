import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The business email inbox (Campaigns → Inbox): every call is scoped to the caller's own business. */

const attachment = z.object({ path: z.string().max(300), name: z.string().min(1).max(160), type: z.string().max(120), size: z.number().int().min(0).max(30_000_000) });
const threadInput = z.object({ threadId: z.string().uuid() });

export const getInboxMailbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { getMailbox } = await import("@/lib/email-inbox.server");
    const { inboundRepliesEnabled } = await import("@/lib/email-inbound.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return { ...(await getMailbox(app.businessId)), receiving: inboundRepliesEnabled(), canEdit: app.role !== "staff" };
  });

export const saveInboxMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    localPart: z.string().min(1).max(64),
    displayName: z.string().max(120).nullable().optional(),
    signature: z.string().max(1000).nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { saveMailbox } = await import("@/lib/email-inbox.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    return saveMailbox(app.businessId, data);
  });

export const getInboxList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    folder: z.enum(["inbox", "sent", "campaigns", "archived"]),
    q: z.string().max(120).optional(),
    unreadOnly: z.boolean().optional(),
    limit: z.number().int().min(10).max(300).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { listInbox } = await import("@/lib/email-inbox.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return listInbox(app.businessId, data);
  });

export const getInboxThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => threadInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const server = await import("@/lib/email-inbox.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const thread = await server.getInboxThread(app.businessId, data.threadId);
    if (thread.messages.some((m) => !m.read)) await server.setThreadRead(app.businessId, data.threadId, true);
    return thread;
  });

export const updateInboxThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    threadId: z.string().uuid(),
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
    leadId: z.string().uuid().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const server = await import("@/lib/email-inbox.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    if (data.read !== undefined) await server.setThreadRead(app.businessId, data.threadId, data.read);
    if (data.archived !== undefined) await server.setThreadArchived(app.businessId, data.threadId, data.archived);
    if (data.leadId !== undefined) await server.linkThreadLead(app.businessId, data.threadId, data.leadId);
    return { ok: true };
  });

export const findInboxLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ q: z.string().max(120), leadId: z.string().uuid().nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { findLeadsForInbox } = await import("@/lib/email-inbox.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return findLeadsForInbox(app.businessId, data.q, data.leadId);
  });

export const getInboxDraft = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    threadId: z.string().uuid(),
    messageId: z.string().uuid().nullable().optional(),
    mode: z.enum(["reply", "reply_all", "forward"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { draftFor } = await import("@/lib/email-inbox.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return draftFor(app.businessId, data);
  });

export const uploadInboxAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    name: z.string().min(1).max(200),
    type: z.string().max(120),
    // 10 MB as base64.
    dataBase64: z.string().min(1).max(14_000_000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { uploadAttachment } = await import("@/lib/email-inbox.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return uploadAttachment(app.businessId, data);
  });

export const sendInboxEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    mode: z.enum(["new", "reply", "reply_all", "forward"]),
    threadId: z.string().uuid().nullable().optional(),
    messageId: z.string().uuid().nullable().optional(),
    to: z.array(z.string().max(320)).max(40),
    cc: z.array(z.string().max(320)).max(40).optional(),
    bcc: z.array(z.string().max(320)).max(40).optional(),
    subject: z.string().max(300).nullable().optional(),
    bodyText: z.string().min(1).max(20_000),
    attachments: z.array(attachment).max(10).optional(),
    includeOriginalAttachments: z.boolean().optional(),
    leadId: z.string().uuid().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const server = await import("@/lib/email-inbox.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return server.sendInboxEmail({ ...data, businessId: app.businessId });
  });

/** Inbox conversations with one customer, for their lead page. */
export const getLeadInboxThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { leadInboxThreads } = await import("@/lib/email-inbox.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return leadInboxThreads(app.businessId, data.leadId);
  });
