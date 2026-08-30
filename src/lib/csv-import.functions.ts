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
    const preview = await loadBatchPreview(supabaseAdmin, app.businessId, data.batchId);
    if (!preview) throw new Error("Import batch not found for this business.");
    return preview;
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
