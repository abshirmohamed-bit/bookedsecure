import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PauseSchema = z.object({ paused: z.boolean() });
const ModeSchema = z.object({
  mode: z.enum(["disabled", "preview_only", "canary_ready", "bounded_batch", "exception_only"]),
});
const CanarySchema = z.object({
  batchId: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  confirm: z.literal(true),
});
const BoundedSchema = z.object({
  batchId: z.string().uuid(),
  rowNumbers: z.array(z.number().int().positive()).min(1).max(3),
  confirm: z.literal(true),
});
const BatchSchema = z.object({ batchId: z.string().uuid(), confirm: z.literal(true) });

async function owner(context: { supabase: never; userId: string }) {
  const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const app = await requireAppContext(context.supabase, context.userId);
  requireOwner(app);
  return { app, supabaseAdmin };
}

/** Read-only rollout status for the current tenant. */
export const getImportAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { loadAutomationOverview } = await import("@/lib/import-automation.server");
    return loadAutomationOverview(supabaseAdmin, app.businessId);
  });

/** Tenant-scoped kill switch. Previewing and classification keep working. */
export const setImportAutomationPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PauseSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { setImportPaused } = await import("@/lib/import-automation.server");
    return setImportPaused(supabaseAdmin, app.businessId, data.paused);
  });

/** Explicit, one-step-at-a-time rollout mode change. */
export const setImportAutomationMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ModeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { changeImportMode } = await import("@/lib/import-automation.server");
    return changeImportMode(supabaseAdmin, app.businessId, data.mode);
  });

/** Runs the one-row canary as a verified controlled execution. */
export const verifyImportCanary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CanarySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { verifyCanaryImport } = await import("@/lib/import-automation.server");
    return verifyCanaryImport(supabaseAdmin, app.businessId, data.batchId, data.rowNumber);
  });

/** Bounded batch of at most three eligible rows. */
export const runImportBoundedBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BoundedSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { runBoundedBatch } = await import("@/lib/import-automation.server");
    return runBoundedBatch(supabaseAdmin, app.businessId, data.batchId, data.rowNumbers);
  });

/** Exception-only import of every remaining eligible row. */
export const runImportExceptionOnly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { app, supabaseAdmin } = await owner(context as never);
    const { runExceptionOnlyImport } = await import("@/lib/import-automation.server");
    return runExceptionOnlyImport(supabaseAdmin, app.businessId, data.batchId);
  });
