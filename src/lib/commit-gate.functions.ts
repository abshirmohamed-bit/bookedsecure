import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BatchSchema = z.object({ batchId: z.string().uuid() });
const RowSchema = z.object({
  batchId: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  confirm: z.literal(true),
});

/** Read-only commit simulation. Owner-gated, tenant resolved from the session. */
export const simulateCrmCommit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { simulateCommit } = await import("@/lib/commit-gate.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return simulateCommit(supabaseAdmin, app.businessId, data.batchId);
  });

/**
 * One-row canary commit. Owner-gated and tenant-scoped. Runs the full
 * pre-commit revalidation and fails closed; it never commits more than the one
 * selected row and never touches messaging, jobs or automation.
 */
export const commitCrmCanaryRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RowSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { commitCanaryRow } = await import("@/lib/commit-gate.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return commitCanaryRow(supabaseAdmin, app.businessId, data.batchId, data.rowNumber);
  });
