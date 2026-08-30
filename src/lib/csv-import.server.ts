// Server-side CRM CSV preview pipeline.
// Writes ONLY to import_batches and lead_import_rows. It never touches leads,
// messages, conversations, jobs, automation_jobs or any provider.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  CsvParseError,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  flagExistingDuplicates,
  flagInBatchDuplicates,
  parseCsv,
  prepareRow,
  unmappedColumns,
  type ExistingLeadIndex,
  type NormalizedPayload,
} from "@/lib/csv-import";

export type PreviewPayload = NormalizedPayload & { duplicate_of_row: number | null };

type Client = SupabaseClient<Database>;

export type PreviewInput = {
  businessId: string;
  userId: string;
  filename: string;
  content: string;
};

export type PreviewRow = {
  row_number: number;
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  normalized_payload: PreviewPayload;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  decision: string;
};

export type PreviewResult = {
  batch: {
    id: string;
    filename: string | null;
    format: string;
    status: string;
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    created_at: string;
  };

  headers: string[];
  unmapped_columns: string[];
  rows: PreviewRow[];
};

export function assertCsvLimits(content: string, rowCount: number): void {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_CSV_BYTES) throw new CsvParseError("The file is larger than 2 MB.");
  if (rowCount > MAX_CSV_ROWS) throw new CsvParseError("The file has more than 2,000 data rows.");
}

async function loadExistingIndex(client: Client, businessId: string): Promise<ExistingLeadIndex> {
  const { data } = await client
    .from("leads")
    .select("id, mobile_number, email_normalised, email")
    .eq("business_id", businessId);
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const lead of data ?? []) {
    if (lead.mobile_number && !byPhone.has(lead.mobile_number)) byPhone.set(lead.mobile_number, lead.id);
    const email = (lead.email_normalised ?? lead.email ?? "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, lead.id);
  }
  return { byPhone, byEmail };
}

/** Parse, map, validate and persist a preview-only CRM import batch. */
export async function previewCrmCsv(client: Client, input: PreviewInput): Promise<PreviewResult> {
  const bytes = new TextEncoder().encode(input.content).length;
  if (bytes > MAX_CSV_BYTES) throw new CsvParseError("The file is larger than 2 MB.");

  const { data: created, error: batchError } = await client
    .from("import_batches")
    .insert({
      business_id: input.businessId,
      uploaded_by: input.userId,
      filename: input.filename,
      format: "crm",
      status: "uploaded",
    })
    .select("*")
    .single();
  if (batchError || !created) throw new Error(batchError?.message ?? "Could not create import batch.");

  try {
    const table = parseCsv(input.content);
    assertCsvLimits(input.content, table.rows.length);

    const prepared = flagInBatchDuplicates(
      table.rows.map((row, index) => prepareRow(table.headers, row, index + 1)),
    );
    const withExisting = flagExistingDuplicates(prepared, await loadExistingIndex(client, input.businessId));

    if (withExisting.length > 0) {
      const { error: rowError } = await client.from("lead_import_rows").insert(
        withExisting.map((row) => ({
          batch_id: created.id,
          business_id: input.businessId,
          row_number: row.row_number,
          raw_row: row.raw_row,
          normalized_payload: {
            ...row.normalized_payload,
            duplicate_of_row: row.duplicate_of_row,
          },
          validation_errors: row.validation_errors,
          dedupe_match_lead_id: row.dedupe_match_lead_id,
          decision: "pending",
        })),
      );
      if (rowError) throw new Error(rowError.message);
    }

    const invalid = withExisting.filter((row) => row.validation_errors.length > 0).length;
    const duplicates = withExisting.filter(
      (row) => row.dedupe_match_lead_id !== null || row.duplicate_of_row !== null,
    ).length;

    const { data: updated } = await client
      .from("import_batches")
      .update({
        status: "previewed",
        total_rows: withExisting.length,
        valid_rows: withExisting.length - invalid,
        invalid_rows: invalid,
        duplicate_rows: duplicates,
      })
      .eq("id", created.id)
      .eq("business_id", input.businessId)
      .select("*")
      .single();

    const batch = updated ?? created;
    return {
      batch: {
        id: batch.id,
        filename: batch.filename,
        format: batch.format,
        status: batch.status,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        invalid_rows: batch.invalid_rows,
        duplicate_rows: batch.duplicate_rows,
      },
      headers: table.headers,
      unmapped_columns: unmappedColumns(table.headers),
      rows: withExisting.map((row) => ({
        row_number: row.row_number,
        name: row.normalized_payload.name,
        mobile_number: row.normalized_payload.mobile_number,
        email: row.normalized_payload.email,
        normalized_payload: { ...row.normalized_payload, duplicate_of_row: row.duplicate_of_row },
        validation_errors: row.validation_errors,
        dedupe_match_lead_id: row.dedupe_match_lead_id,
        duplicate_of_row: row.duplicate_of_row,
        decision: "pending",
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parsing failure.";
    await client
      .from("import_batches")
      .update({ status: "failed" })
      .eq("id", created.id)
      .eq("business_id", input.businessId);
    await client.from("lead_import_rows").insert({
      batch_id: created.id,
      business_id: input.businessId,
      row_number: 0,
      raw_row: { filename: input.filename },
      normalized_payload: null,
      validation_errors: [{ code: "parse_failed", detail: message }],
      decision: "pending",
    });
    throw new Error(message);
  }
}

/**
 * Removes a preview-only batch and its staged rows.
 *
 * Touches nothing but import_batches and lead_import_rows: no leads,
 * conversations, messages, jobs, automation_jobs or provider calls.
 */
export async function deletePreviewBatch(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<{ batchId: string; filename: string | null; deletedRows: number }> {
  const { DELETABLE_BATCH_STATUSES } = await import("@/lib/import-history");

  const { data: batch } = await client
    .from("import_batches")
    .select("id, filename, status")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found for this business.");

  if (!(DELETABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new Error("This upload has already been committed, so its rows cannot be deleted.");
  }

  const { data: staged } = await client
    .from("lead_import_rows")
    .select("id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId);

  const rowsDelete = await client
    .from("lead_import_rows")
    .delete()
    .eq("batch_id", batchId)
    .eq("business_id", businessId);
  if (rowsDelete.error) throw new Error(rowsDelete.error.message);

  const batchDelete = await client
    .from("import_batches")
    .delete()
    .eq("id", batchId)
    .eq("business_id", businessId);
  if (batchDelete.error) throw new Error(batchDelete.error.message);

  return { batchId, filename: batch.filename, deletedRows: (staged ?? []).length };
}

/** Tenant-scoped batch read. A batch from another business is not visible. */
export async function loadBatchPreview(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<PreviewResult | null> {
  const { data: batch } = await client
    .from("import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) return null;


  const { data: rows } = await client
    .from("lead_import_rows")
    .select("*")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const mapped = (rows ?? []).map((row) => {
    const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload;
    return {
      row_number: row.row_number,
      name: payload.name ?? null,
      mobile_number: payload.mobile_number ?? null,
      email: payload.email ?? null,
      normalized_payload: payload,
      validation_errors: (row.validation_errors ?? []) as PreviewRow["validation_errors"],
      dedupe_match_lead_id: row.dedupe_match_lead_id,
      duplicate_of_row: payload.duplicate_of_row ?? null,
      decision: row.decision,
    };
  });

  const headers = Object.keys((rows?.[0]?.raw_row ?? {}) as Record<string, unknown>);
  const unmapped = mapped[0]?.normalized_payload?.unmapped_columns;

  return {
    batch: {
      id: batch.id,
      filename: batch.filename,
      format: batch.format,
      status: batch.status,
      total_rows: batch.total_rows,
      valid_rows: batch.valid_rows,
      invalid_rows: batch.invalid_rows,
      duplicate_rows: batch.duplicate_rows,
    },
    headers,
    unmapped_columns: unmapped ?? [],
    rows: mapped,
  };
}
