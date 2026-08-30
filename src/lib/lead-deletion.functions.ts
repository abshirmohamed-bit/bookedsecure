import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

/** Soft-deletes the caller's own leads. Tenant-scoped and idempotent per requestId. */
export const softDeleteLeadsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { softDeleteLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return softDeleteLeads(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      requestId: data.requestId,
      leadIds: data.leadIds,
      reason: data.reason ?? null,
      allowProtected: data.allowProtected,
    });
  });

/** Recovery view data. Owner-gated, tenant-scoped, read-only. */
export const getDeletedLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listDeletedLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return { role: app.role, leads: await listDeletedLeads(supabaseAdmin, app.businessId) };
  });

/** Restores soft-deleted leads in place. Owner-gated, never creates duplicates. */
export const restoreLeadsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RestoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { restoreLeads } = await import("@/lib/lead-deletion.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return restoreLeads(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      leadIds: data.leadIds,
    });
  });
