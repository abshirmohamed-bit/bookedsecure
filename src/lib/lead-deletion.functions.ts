import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_PAGE_SIZE } from "@/lib/lead-pagination";

const DeleteSchema = z.object({
  requestId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().max(500).optional(),
  allowProtected: z.boolean().optional(),
  confirm: z.literal(true),
});

const RestoreSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(200),
  confirm: z.literal(true),
});

const PurgeSchema = z.object({
  requestId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().max(500).optional(),
  confirmationPhrase: z.string(),
});

/** Owner-only permanent deletion of already soft-deleted leads. */
export const permanentlyDeleteLeadsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PurgeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isPurgeConfirmed } = await import("@/lib/lead-purge");
    const { permanentlyDeleteLeads } = await import("@/lib/lead-purge.server");
    if (!isPurgeConfirmed(data.confirmationPhrase)) {
      throw new Error("Type DELETE to confirm permanent deletion.");
    }
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    return permanentlyDeleteLeads(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      requestId: data.requestId,
      leadIds: data.leadIds,
      reason: data.reason ?? null,
    });
  });

/** Soft-deletes the caller's own leads. Tenant-scoped and idempotent per requestId. */
export const softDeleteLeadsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { softDeleteLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return softDeleteLeads(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      requestId: data.requestId,
      leadIds: data.leadIds,
      reason: data.reason ?? null,
      ...(data.allowProtected === undefined ? {} : { allowProtected: data.allowProtected }),
    });
  });

/** Recovery view data. Owner-gated, tenant-scoped, read-only. */
const DeletedPageSchema = z.object({
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
});

export const getDeletedLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeletedPageSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listDeletedLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const result = await listDeletedLeads(supabaseAdmin, app.businessId, {
      page: data.page ?? 1,
      pageSize: data.pageSize ?? DEFAULT_PAGE_SIZE,
    });
    return { role: app.role, leads: result.leads, page: result.page };
  });

/** Restores soft-deleted leads in place. Owner-gated, never creates duplicates. */
export const restoreLeadsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RestoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { restoreLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    return restoreLeads(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      leadIds: data.leadIds,
    });
  });
