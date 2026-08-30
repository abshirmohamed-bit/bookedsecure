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
import {
  DEFAULT_REVIEW,
  applyClassificationToReview,
  classifyRow,
  readClassification,
  readReview,
  resolveDecisionChange,
  type DuplicateLookup,
  type RowClassification,
  type RowDecision,
  type ExclusionReason,
  type RowReview,
} from "@/lib/row-review";

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
  review: RowReview;
  classification: RowClassification;
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

/**
 * Read-only, tenant-scoped duplicate preflight.
 *
 * Uses the project's existing lead identity rule: normalized AU mobile in
 * E.164 form, or normalized (lower-cased, trimmed) email, scoped to one
 * business_id. It only SELECTs from leads — never insert, update or delete.
 */
async function loadExistingIndex(
  client: Client,
  businessId: string,
): Promise<{ state: "checked" | "error"; index: ExistingLeadIndex }> {
  const { data, error } = await client
    .from("leads")
    .select("id, mobile_number, email_normalised, email")
    .eq("business_id", businessId);
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  if (error) return { state: "error", index: { byPhone, byEmail } };
  for (const lead of data ?? []) {
    if (lead.mobile_number && !byPhone.has(lead.mobile_number)) byPhone.set(lead.mobile_number, lead.id);
    const email = (lead.email_normalised ?? lead.email ?? "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, lead.id);
  }
  return { state: "checked", index: { byPhone, byEmail } };
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
    // Read-only, tenant-scoped duplicate preflight against existing leads.
    const lookup = await loadExistingIndex(client, input.businessId);
    const duplicateLookup: DuplicateLookup = { state: lookup.state };
    const withExisting = flagExistingDuplicates(prepared, lookup.index);

    // Every row starts pending; the deterministic classifier may then promote a
    // fully verified clean row to `include` (dry-run candidate only).
    const classified = withExisting.map((row) => {
      const classification = classifyRow(
        {
          name: row.normalized_payload.name,
          email: row.normalized_payload.email,
          mobile_number: row.normalized_payload.mobile_number,
          validation_errors: row.validation_errors,
          dedupe_match_lead_id: row.dedupe_match_lead_id,
          duplicate_of_row: row.duplicate_of_row,
        },
        duplicateLookup,
      );
      return {
        ...row,
        classification,
        review: applyClassificationToReview({ ...DEFAULT_REVIEW }, classification),
      };
    });

    if (classified.length > 0) {
      const { error: rowError } = await client.from("lead_import_rows").insert(
        classified.map((row) => ({
          batch_id: created.id,
          business_id: input.businessId,
          row_number: row.row_number,
          raw_row: row.raw_row,
          normalized_payload: {
            ...row.normalized_payload,
            duplicate_of_row: row.duplicate_of_row,
            review: row.review,
            ...row.classification,
          },
          validation_errors: row.validation_errors,
          dedupe_match_lead_id: row.dedupe_match_lead_id,
          decision: "pending",
        })),
      );
      if (rowError) throw new Error(rowError.message);
    }

    const invalid = classified.filter((row) => row.validation_errors.length > 0).length;
    const duplicates = classified.filter(
      (row) => row.dedupe_match_lead_id !== null || row.duplicate_of_row !== null,
    ).length;

    const { data: updated } = await client
      .from("import_batches")
      .update({
        status: "previewed",
        total_rows: classified.length,
        valid_rows: classified.length - invalid,
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
        created_at: batch.created_at ?? new Date().toISOString(),

      },
      headers: table.headers,
      unmapped_columns: unmappedColumns(table.headers),
      rows: classified.map((row) => ({
        row_number: row.row_number,
        name: row.normalized_payload.name,
        mobile_number: row.normalized_payload.mobile_number,
        email: row.normalized_payload.email,
        normalized_payload: { ...row.normalized_payload, duplicate_of_row: row.duplicate_of_row },
        validation_errors: row.validation_errors,
        dedupe_match_lead_id: row.dedupe_match_lead_id,
        duplicate_of_row: row.duplicate_of_row,
        decision: "pending",
        review: row.review,
        classification: row.classification,
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
      review: readReview(payload),
      classification: readClassification(payload),
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
      created_at: batch.created_at ?? new Date().toISOString(),

    },
    headers,
    unmapped_columns: unmapped ?? [],
    rows: mapped,
  };
}

/**
 * Update the review decision for one staged preview row.
 *
 * Preview-only: this writes ONLY the `review` object inside
 * lead_import_rows.normalized_payload. It never inserts, updates or merges
 * leads, never creates conversations, messages, jobs or automation jobs, and
 * never calls a messaging provider. The legacy `decision` column is left
 * untouched so existing preview records keep their `pending` value.
 */
export async function setRowReviewDecision(
  client: Client,
  businessId: string,
  input: {
    batchId: string;
    rowNumber: number;
    decision: RowDecision;
    exclusionReason?: ExclusionReason | null;
  },
): Promise<{ rowNumber: number; review: RowReview }> {
  const { DELETABLE_BATCH_STATUSES } = await import("@/lib/import-history");

  const { data: batch } = await client
    .from("import_batches")
    .select("id, status")
    .eq("id", input.batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found for this business.");
  if (!(DELETABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new Error("This upload has already been committed, so its rows cannot be reviewed.");
  }

  const { data: row } = await client
    .from("lead_import_rows")
    .select("id, normalized_payload, validation_errors")
    .eq("batch_id", input.batchId)
    .eq("business_id", businessId)
    .eq("row_number", input.rowNumber)
    .maybeSingle();
  if (!row) throw new Error("Preview row not found for this business.");

  const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload;
  const review = resolveDecisionChange(
    {
      mobile_number: payload.mobile_number ?? null,
      validation_errors: (row.validation_errors ?? []) as PreviewRow["validation_errors"],
    },
    { decision: input.decision, exclusion_reason: input.exclusionReason ?? null },
  );

  const { error } = await client
    .from("lead_import_rows")
    .update({ normalized_payload: { ...payload, review } as never })
    .eq("id", row.id)
    .eq("business_id", businessId);
  if (error) throw new Error(error.message);

  return { rowNumber: input.rowNumber, review };
}

/**
 * Re-run the deterministic classifier over an uncommitted staged batch.
 *
 * Idempotent and preview-only: it re-runs the read-only, tenant-scoped
 * duplicate preflight, then writes ONLY the `review` object and classification
 * metadata inside lead_import_rows.normalized_payload. Raw CSV data, normalized
 * fields, source metadata, validation errors and the legacy `decision` column
 * are never modified, and manual decisions are always preserved.
 */
export async function classifyPreviewBatch(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<{
  batchId: string;
  duplicate_lookup_state: DuplicateLookup["state"];
  rows: number;
  auto_included: number;
  manual_review: number;
  preserved_manual: number;
}> {
  const { DELETABLE_BATCH_STATUSES } = await import("@/lib/import-history");

  const { data: batch } = await client
    .from("import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found for this business.");
  if (!(DELETABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new Error("This upload has already been committed, so it cannot be reclassified.");
  }

  const { data: rows } = await client
    .from("lead_import_rows")
    .select("id, row_number, normalized_payload, validation_errors, dedupe_match_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const lookup = await loadExistingIndex(client, businessId);
  const duplicateLookup: DuplicateLookup = { state: lookup.state };

  let autoIncluded = 0;
  let manualReview = 0;
  let preservedManual = 0;

  for (const row of rows ?? []) {
    const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload;
    const errors = (row.validation_errors ?? []) as PreviewRow["validation_errors"];
    const phone = payload.mobile_number ?? null;
    const email = payload.email_normalised ?? payload.email ?? null;
    // Existing lead identity rule: normalized AU mobile, or normalized email.
    const storedMatch: string | null =
      typeof row.dedupe_match_lead_id === "string" ? row.dedupe_match_lead_id : null;
    const phoneMatch = phone ? (lookup.index.byPhone.get(phone) ?? null) : null;
    const emailMatch = email ? (lookup.index.byEmail.get(email.toLowerCase()) ?? null) : null;
    const existingMatch: string | null = storedMatch ?? phoneMatch ?? emailMatch;

    const classification = classifyRow(
      {
        name: payload.name ?? null,
        email: payload.email ?? null,
        mobile_number: phone,
        validation_errors: errors,
        dedupe_match_lead_id: lookup.state === "checked" ? existingMatch : null,
        duplicate_of_row: payload.duplicate_of_row ?? null,
      },
      duplicateLookup,
    );

    const current = readReview(payload);
    const review = applyClassificationToReview(current, classification);
    if (current.source === "manual") preservedManual += 1;
    if (classification.classification === "auto_include") autoIncluded += 1;
    else manualReview += 1;

    const { error } = await client
      .from("lead_import_rows")
      .update({ normalized_payload: { ...payload, review, ...classification } as never })
      .eq("id", row.id)
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);
  }

  return {
    batchId,
    duplicate_lookup_state: duplicateLookup.state,
    rows: (rows ?? []).length,
    auto_included: autoIncluded,
    manual_review: manualReview,
    preserved_manual: preservedManual,
  };
}
