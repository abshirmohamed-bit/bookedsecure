import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_CSV_BYTES } from "@/lib/csv-import";

const UploadSchema = z.object({
  filename: z.string().min(1).max(200),
  content: z.string().min(1).max(MAX_CSV_BYTES * 2),
});

const BatchSchema = z.object({ batchId: z.string().uuid() });

/** Preview-only CRM CSV upload. Owner-gated, tenant scoped server-side. */
export const previewCrmImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewCrmCsv } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return previewCrmCsv(supabaseAdmin, {
      businessId: app.businessId,
      userId: app.userId,
      filename: data.filename,
      content: data.content,
    });
  });

export const getCrmImportBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadBatchPreview } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    // Missing/deleted batches are a normal race (e.g. a stale selection after a
    // delete), not an exception — return null so the UI can render a notice.
    const preview = await loadBatchPreview(supabaseAdmin, app.businessId, data.batchId);
    return preview ?? null;
  });

export const listCrmImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const { data } = await supabaseAdmin
      .from("import_batches")
      .select("id, filename, format, status, total_rows, valid_rows, invalid_rows, duplicate_rows, created_at")
      .eq("business_id", app.businessId)
      .order("created_at", { ascending: false })
      .limit(20);
    return { role: app.role, batches: data ?? [] };
  });

/**
 * Deletes one preview batch and its staged rows. Owner-gated, tenant resolved
 * from the authenticated session — the batch id from the browser is only ever
 * used inside a business-scoped filter. Live data is never touched.
 */
export const deleteCrmImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deletePreviewBatch } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return deletePreviewBatch(supabaseAdmin, app.businessId, data.batchId);
  });


const DecisionSchema = z.object({
  batchId: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  decision: z.enum(["pending", "include", "exclude"]),
  exclusionReason: z
    .enum([
      "invalid_phone",
      "not_mobile",
      "duplicate",
      "bad_data",
      "not_relevant",
      "manually_excluded",
    ])
    .nullable()
    .optional(),
});

/**
 * Preview-only row review. Owner-gated, tenant resolved from the session.
 * Touches only the staged row's review state — no leads, conversations,
 * messages, jobs, automation or provider calls.
 */
export const setCrmImportRowDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setRowReviewDecision } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return setRowReviewDecision(supabaseAdmin, app.businessId, {
      batchId: data.batchId,
      rowNumber: data.rowNumber,
      decision: data.decision,
      exclusionReason: data.exclusionReason ?? null,
    });
  });

/**
 * Re-runs the preview classifier and the read-only duplicate preflight for one
 * staged batch. Owner-gated, tenant resolved from the session. Preview-only:
 * no leads, conversations, messages, jobs, automation or provider calls.
 */
export const classifyCrmImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { classifyPreviewBatch } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return classifyPreviewBatch(supabaseAdmin, app.businessId, data.batchId);
  });

/**
 * Runs the deterministic staged-row phone repair engine across one preview
 * batch, then re-runs validation, the read-only duplicate preflight and the
 * classifier. Owner-gated, tenant resolved from the session. Preview-only: no
 * leads, conversations, messages, jobs, revenue, automation or provider calls.
 */
export const repairCrmImportPhones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { repairPreviewBatch } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return repairPreviewBatch(supabaseAdmin, app.businessId, data.batchId, {
      userId: app.userId,
    });
  });



const EditSchema = z.object({
  batchId: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  fields: z.record(
    z.enum([
      "name",
      "email",
      "phone",
      "secondary_phone",
      "whatsapp_number",
      "status",
      "source",
      "form",
      "channel",
      "owner",
      "labels",
      "created_at",
    ]),
    z.string().trim().max(300),
  ),
  reason: z.string().trim().max(300).nullable().optional(),
});

/**
 * Edit one staged preview row and revalidate it. Owner-gated, tenant resolved
 * from the session — the batch id and row number from the browser are only used
 * inside a business-scoped filter. Preview-only: no live leads, conversations,
 * messages, jobs, revenue, notifications, automation or provider calls.
 */
export const editCrmImportRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EditSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { editStagedRow } = await import("@/lib/csv-import.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return editStagedRow(supabaseAdmin, app.businessId, {
      batchId: data.batchId,
      rowNumber: data.rowNumber,
      userId: app.userId,
      fields: data.fields,
      reason: data.reason ?? null,
    });
  });
