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
  restageStage,
  canonicalField,
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
import type { EditableField, StagedRowState } from "@/lib/staged-row-edit";

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
export async function loadExistingIndex(
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
      table.rows.map((row, index) =>
        prepareRow(table.headers, row, index + 1, { filename: input.filename }),
      ),
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
    .select("id, row_number, raw_row, normalized_payload, validation_errors, dedupe_match_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const lookup = await loadExistingIndex(client, businessId);
  const duplicateLookup: DuplicateLookup = { state: lookup.state };

  let autoIncluded = 0;
  let manualReview = 0;
  let preservedManual = 0;

  for (const row of rows ?? []) {
    let payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload;
    let errors = (row.validation_errors ?? []) as PreviewRow["validation_errors"];

    // Re-apply the stage mapping to staged rows so historical CRM stages that
    // are now mappable stop being held as exceptions. Preview-only: raw CSV
    // data, contact fields, source metadata and dates are preserved verbatim,
    // and the original stage text is kept in source_metadata.stage_raw.
    const metadata = (payload.source_metadata ?? {}) as Record<string, string>;
    const rawRow = (row.raw_row ?? {}) as Record<string, unknown>;
    const rawStageHeader = Object.keys(rawRow).find(
      (header) => canonicalField(header) === "status",
    );
    const stageText =
      metadata["stage_raw"] ??
      (rawStageHeader ? String(rawRow[rawStageHeader] ?? "").trim() : "");
    const restaged = restageStage(stageText, errors);
    if (restaged.stage_raw && (restaged.changed || metadata["stage_raw"] !== restaged.stage_raw)) {
      errors = restaged.errors;
      payload = {
        ...payload,
        proposed_status: restaged.status ?? payload.proposed_status ?? null,
        source_metadata: { ...metadata, stage_raw: restaged.stage_raw },
      };
      const stageUpdate = await client
        .from("lead_import_rows")
        .update({ normalized_payload: payload as never, validation_errors: errors as never })
        .eq("id", row.id)
        .eq("business_id", businessId);
      if (stageUpdate.error) throw new Error(stageUpdate.error.message);
    }
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

// --- automatic staged-row phone repair ----------------------------------------

export type RepairPhase = {
  valid_au_mobiles: number;
  repaired_au_mobiles: number;
  valid_au_landlines: number;
  invalid_phones: number;
  incomplete_or_ambiguous_phones: number;
  empty_phones: number;
  duplicates: number;
  eligible_rows: number;
};

export type RepairRunResult = {
  batchId: string;
  rows_scanned: number;
  rows_updated: number;
  high_confidence_applied: number;
  medium_confidence_suggestions: number;
  low_confidence_or_unrepairable: number;
  extra_trunk_zero_repairs: number;
  nine_digit_mobile_repairs: number;
  raw_values_preserved: boolean;
  before: RepairPhase;
  after: RepairPhase;
  duplicate_lookup_state: DuplicateLookup["state"];
};

const PHONE_ERROR_CODES = [
  "invalid_phone",
  "unsupported_phone_type",
  "missing_phone_and_email",
] as const;
const IN_FILE_DUPLICATE_CODES = ["duplicate_phone_in_file", "duplicate_email_in_file"] as const;

function emptyPhase(): RepairPhase {
  return {
    valid_au_mobiles: 0,
    repaired_au_mobiles: 0,
    valid_au_landlines: 0,
    invalid_phones: 0,
    incomplete_or_ambiguous_phones: 0,
    empty_phones: 0,
    duplicates: 0,
    eligible_rows: 0,
  };
}

/**
 * Run the deterministic phone repair engine across one uncommitted staged batch.
 *
 * SAFETY: writes ONLY `lead_import_rows` for this batch (normalized value,
 * repair provenance, issue list, in-batch duplicate pointer) plus one
 * `audit_events` record. It never inserts or updates leads, conversations,
 * messages, jobs, revenue, notifications or automation runs, and never calls a
 * messaging provider. Raw uploaded rows, batch identity, source, form, channel,
 * stage, created date, owner, labels and import provenance are untouched.
 *
 * Idempotent: the engine is pure, so a second run recomputes the same values and
 * keeps the first repair timestamp.
 */
export async function repairPreviewBatch(
  client: Client,
  businessId: string,
  batchId: string,
  options: { userId?: string | null } = {},
): Promise<RepairRunResult> {
  const { DELETABLE_BATCH_STATUSES } = await import("@/lib/import-history");
  const { resolvePhoneWithRepair } = await import("@/lib/csv-import");
  const { readPhoneRepair, stampRepair } = await import("@/lib/phone-repair");

  const { data: batch } = await client
    .from("import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found for this business.");
  if (!(DELETABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new Error("This upload has already been committed, so its rows cannot be repaired.");
  }

  const { data: rows } = await client
    .from("lead_import_rows")
    .select("id, row_number, raw_row, normalized_payload, validation_errors, dedupe_match_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const before = emptyPhase();
  const after = emptyPhase();
  let applied = 0;
  let medium = 0;
  let low = 0;
  let extraTrunkZero = 0;
  let nineDigit = 0;
  let updated = 0;
  let rawPreserved = true;
  const now = new Date().toISOString();

  type Staged = {
    id: string;
    row_number: number;
    payload: PreviewPayload & Record<string, unknown>;
    errors: PreviewRow["validation_errors"];
    mobile: string | null;
    email: string | null;
    duplicate_of_row: number | null;
    repair: ReturnType<typeof stampRepair>;
  };

  const staged: Staged[] = [];

  for (const row of rows ?? []) {
    const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload &
      Record<string, unknown>;
    const priorErrors = (row.validation_errors ?? []) as PreviewRow["validation_errors"];
    const priorCodes = priorErrors.map((issue) => issue.code);
    const metadata = { ...((payload.source_metadata ?? {}) as Record<string, string>) };
    const priorRepair = readPhoneRepair(payload);

    // "before" counters, from the values staged prior to this run.
    if (priorCodes.includes("unsupported_phone_type")) before.valid_au_landlines += 1;
    else if (priorCodes.includes("invalid_phone")) before.invalid_phones += 1;
    else if (payload.mobile_number) before.valid_au_mobiles += 1;
    else before.empty_phones += 1;
    if (priorRepair?.classification === "repaired_au_mobile") before.repaired_au_mobiles += 1;
    if (row.dedupe_match_lead_id || (payload.duplicate_of_row ?? null) !== null) {
      before.duplicates += 1;
    }
    if (readClassification(payload).classification === "auto_include") before.eligible_rows += 1;

    // The raw uploaded phone text: the immutable source for every repair.
    const rawRow = (row.raw_row ?? {}) as Record<string, unknown>;
    const rawHeader = Object.keys(rawRow).find(
      (header) => canonicalField(header) === "mobile_number",
    );
    const rawPhone =
      priorRepair?.original ??
      metadata["phone_raw"] ??
      (rawHeader ? String(rawRow[rawHeader] ?? "").trim() : "") ??
      "";
    if (priorRepair && priorRepair.original !== rawPhone) rawPreserved = false;

    const resolved = resolvePhoneWithRepair(rawPhone);
    const repair = stampRepair(resolved.repair, {
      stagedRowId: row.id,
      batchId,
      at: now,
      previous: priorRepair,
    });

    if (repair.applied && repair.classification === "repaired_au_mobile") applied += 1;
    if (repair.confidence === "medium") medium += 1;
    if (repair.confidence === "low") low += 1;
    if (repair.actions.includes("removed_extra_trunk_zero")) extraTrunkZero += 1;
    if (repair.actions.includes("added_country_code") && repair.applied) nineDigit += 1;

    const email = (payload.email_normalised ?? payload.email ?? "").trim().toLowerCase() || null;
    const mobile = resolved.mobile_number;

    // Recompute only the phone/duplicate issue codes; every other issue stands.
    const kept = priorErrors.filter(
      (issue) =>
        !(PHONE_ERROR_CODES as readonly string[]).includes(issue.code) &&
        !(IN_FILE_DUPLICATE_CODES as readonly string[]).includes(issue.code),
    );
    const errors: PreviewRow["validation_errors"] = [...kept, ...resolved.errors];
    if (!mobile && !email) errors.push({ code: "missing_phone_and_email" });

    if (rawPhone) metadata["phone_raw"] = rawPhone;
    if (repair.normalized && repair.normalized !== rawPhone) {
      metadata["phone_repaired"] = repair.normalized;
    }

    staged.push({
      id: row.id,
      row_number: row.row_number,
      payload: { ...payload, source_metadata: metadata },
      errors,
      mobile,
      email,
      duplicate_of_row: null,
      repair,
    });
  }

  // In-batch duplicates are recomputed from the repaired values, first row wins.
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (const row of staged) {
    if (row.mobile && seenPhone.has(row.mobile)) {
      row.duplicate_of_row = seenPhone.get(row.mobile)!;
      row.errors.push({
        code: "duplicate_phone_in_file",
        field: "mobile_number",
        detail: `row ${row.duplicate_of_row}`,
      });
    } else if (row.email && seenEmail.has(row.email)) {
      row.duplicate_of_row = seenEmail.get(row.email)!;
      row.errors.push({
        code: "duplicate_email_in_file",
        field: "email",
        detail: `row ${row.duplicate_of_row}`,
      });
    }
    if (row.mobile && !seenPhone.has(row.mobile)) seenPhone.set(row.mobile, row.row_number);
    if (row.email && !seenEmail.has(row.email)) seenEmail.set(row.email, row.row_number);
  }

  for (const row of staged) {
    const nextPayload = {
      ...row.payload,
      mobile_number: row.mobile,
      duplicate_of_row: row.duplicate_of_row,
      phone_repair: row.repair,
    };
    const unchanged =
      JSON.stringify(row.payload.mobile_number ?? null) === JSON.stringify(row.mobile) &&
      (row.payload.duplicate_of_row ?? null) === row.duplicate_of_row &&
      JSON.stringify((row.payload as { phone_repair?: unknown }).phone_repair ?? null) ===
        JSON.stringify(row.repair);
    if (!unchanged) updated += 1;

    const { error } = await client
      .from("lead_import_rows")
      .update({
        normalized_payload: nextPayload as never,
        validation_errors: row.errors as never,
      })
      .eq("id", row.id)
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);

    switch (row.repair.classification) {
      case "valid_au_mobile":
        after.valid_au_mobiles += 1;
        break;
      case "repaired_au_mobile":
        after.repaired_au_mobiles += 1;
        after.valid_au_mobiles += 1;
        break;
      case "valid_au_landline":
        after.valid_au_landlines += 1;
        break;
      case "invalid_phone":
        after.invalid_phones += 1;
        break;
      case "incomplete_phone":
      case "ambiguous_phone":
        after.incomplete_or_ambiguous_phones += 1;
        break;
      case "empty_phone":
        after.empty_phones += 1;
        break;
    }
  }

  // Re-run the read-only tenant-scoped duplicate preflight and classifier so the
  // repaired values drive duplicate status and auto-include eligibility.
  const classified = await classifyPreviewBatch(client, businessId, batchId);
  after.eligible_rows = classified.auto_included;

  const { data: refreshed } = await client
    .from("lead_import_rows")
    .select("normalized_payload, dedupe_match_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId);
  after.duplicates = (refreshed ?? []).filter((row) => {
    const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload;
    return Boolean(row.dedupe_match_lead_id) || (payload.duplicate_of_row ?? null) !== null;
  }).length;

  if (options.userId) {
    await client.from("audit_events").insert({
      business_id: businessId,
      user_id: options.userId,
      event_type: "import_phone_repair_run",
      entity_type: "import_batch",
      entity_id: batchId,
      metadata: {
        batch_id: batchId,
        rows_scanned: staged.length,
        rows_updated: updated,
        high_confidence_applied: applied,
        medium_confidence_suggestions: medium,
        low_confidence_or_unrepairable: low,
        extra_trunk_zero_repairs: extraTrunkZero,
        nine_digit_mobile_repairs: nineDigit,
        engine_version: staged[0]?.repair.engine_version ?? null,
      } as never,
    });
  }

  return {
    batchId,
    rows_scanned: staged.length,
    rows_updated: updated,
    high_confidence_applied: applied,
    medium_confidence_suggestions: medium,
    low_confidence_or_unrepairable: low,
    extra_trunk_zero_repairs: extraTrunkZero,
    nine_digit_mobile_repairs: nineDigit,
    raw_values_preserved: rawPreserved,
    before,
    after,
    duplicate_lookup_state: classified.duplicate_lookup_state,
  };
}



/**
 * Edit ONE staged preview row.
 *
 * SAFETY: writes only to `lead_import_rows` (this row) plus one `audit_events`
 * record. It never inserts or updates leads, never creates conversations,
 * messages, jobs, revenue, notifications or automation runs, and never calls a
 * messaging provider. The raw uploaded row, batch id, business id, row number,
 * import origin and any assigned commit/idempotency bookkeeping are untouched.
 *
 * After saving it re-runs the full revalidation chain: field normalization, AU
 * phone classification, email validation, name validation, stage mapping, the
 * tenant-scoped duplicate check against live leads and the in-batch duplicate
 * check, then recomputes the issue list, classification and row state.
 */
export async function editStagedRow(
  client: Client,
  businessId: string,
  input: {
    batchId: string;
    rowNumber: number;
    userId: string;
    fields: Partial<Record<EditableField, string>>;
    reason?: string | null;
  },
): Promise<{
  rowNumber: number;
  changed_fields: EditableField[];
  row: PreviewRow;
  state: StagedRowState;
  duplicate: { existing_lead_id: string | null; in_batch_row: number | null };
}> {
  const { DELETABLE_BATCH_STATUSES } = await import("@/lib/import-history");
  const { applyStagedEdit, resolveStagedRowState } = await import("@/lib/staged-row-edit");
  const { readCommitState } = await import("@/lib/commit-gate");

  const { data: batch } = await client
    .from("import_batches")
    .select("id, status")
    .eq("id", input.batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found for this business.");
  if (!(DELETABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    throw new Error("This upload has already been committed, so its rows cannot be edited.");
  }

  const { data: row } = await client
    .from("lead_import_rows")
    .select("id, row_number, raw_row, normalized_payload, validation_errors, dedupe_match_lead_id")
    .eq("batch_id", input.batchId)
    .eq("business_id", businessId)
    .eq("row_number", input.rowNumber)
    .maybeSingle();
  if (!row) throw new Error("Preview row not found for this business.");

  const payload = (row.normalized_payload ?? {}) as unknown as PreviewPayload &
    Record<string, unknown>;
  if (readCommitState(payload).status === "committed") {
    throw new Error("This row has already been committed, so it cannot be edited.");
  }

  const applied = applyStagedEdit(payload, input.fields, {
    userId: input.userId,
    reason: input.reason ?? null,
  });

  // --- duplicate revalidation (read-only, tenant scoped) ---------------------
  const lookup = await loadExistingIndex(client, businessId);
  const duplicateLookup: DuplicateLookup = { state: lookup.state };
  const phone = applied.normalized.mobile_number;
  const email = applied.normalized.email_normalised;
  const existingMatch =
    lookup.state === "checked"
      ? ((phone ? lookup.index.byPhone.get(phone) : null) ??
        (email ? lookup.index.byEmail.get(email) : null) ??
        null)
      : null;

  const { data: siblings } = await client
    .from("lead_import_rows")
    .select("row_number, normalized_payload")
    .eq("batch_id", input.batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  let inBatchRow: number | null = null;
  for (const sibling of siblings ?? []) {
    if (sibling.row_number === input.rowNumber) continue;
    const other = (sibling.normalized_payload ?? {}) as unknown as PreviewPayload;
    const otherEmail = (other.email_normalised ?? other.email ?? "").toLowerCase() || null;
    const matches =
      (phone && other.mobile_number === phone) || (email && otherEmail === email) ? true : false;
    if (matches) {
      inBatchRow = sibling.row_number;
      break;
    }
  }

  const errors: PreviewRow["validation_errors"] = [...applied.validation_errors];
  if (inBatchRow !== null) {
    if (phone) errors.push({ code: "duplicate_phone_in_file", field: "mobile_number", detail: `row ${inBatchRow}` });
    else errors.push({ code: "duplicate_email_in_file", field: "email", detail: `row ${inBatchRow}` });
  }
  if (existingMatch) {
    errors.push(
      phone && lookup.index.byPhone.get(phone) === existingMatch
        ? { code: "duplicate_existing_phone", field: "mobile_number" }
        : { code: "duplicate_existing_email", field: "email" },
    );
  }

  const nextPayload = {
    ...applied.payload,
    duplicate_of_row: inBatchRow,
  } as unknown as PreviewPayload & Record<string, unknown>;

  const classification = classifyRow(
    {
      name: applied.normalized.name,
      email: applied.normalized.email,
      mobile_number: phone,
      validation_errors: errors,
      dedupe_match_lead_id: existingMatch,
      duplicate_of_row: inBatchRow,
    },
    duplicateLookup,
  );
  // An edit always re-enters validation: the prior manual decision is cleared so
  // a repaired row cannot keep a stale `include`, and a broken row cannot keep one.
  const review = applyClassificationToReview({ ...DEFAULT_REVIEW }, classification);

  const stored = { ...nextPayload, review, ...classification } as never;
  const { error: updateError } = await client
    .from("lead_import_rows")
    .update({
      normalized_payload: stored,
      validation_errors: errors as never,
      dedupe_match_lead_id: existingMatch,
    })
    .eq("id", row.id)
    .eq("business_id", businessId);
  if (updateError) throw new Error(updateError.message);

  if (applied.changes.length > 0) {
    await client.from("audit_events").insert({
      business_id: businessId,
      user_id: input.userId,
      event_type: "import_row_edited",
      entity_type: "lead_import_row",
      entity_id: row.id,
      metadata: {
        batch_id: input.batchId,
        staged_row_id: row.id,
        row_number: input.rowNumber,
        changed_fields: applied.changes.map((change) => change.field),
        previous_values: Object.fromEntries(applied.changes.map((c) => [c.field, c.from])),
        new_values: Object.fromEntries(applied.changes.map((c) => [c.field, c.to])),
        reason: input.reason ?? null,
        revision: applied.payload.edits?.revision ?? null,
      } as never,
    });
  }

  const previewRow: PreviewRow = {
    row_number: input.rowNumber,
    name: applied.normalized.name,
    mobile_number: phone,
    email: applied.normalized.email,
    normalized_payload: nextPayload as unknown as PreviewPayload,
    validation_errors: errors,
    dedupe_match_lead_id: existingMatch,
    duplicate_of_row: inBatchRow,
    decision: "pending",
    review,
    classification,
  };

  return {
    rowNumber: input.rowNumber,
    changed_fields: applied.changes.map((change) => change.field),
    row: previewRow,
    state: resolveStagedRowState({
      commit_status: readCommitState(nextPayload).status,
      review_decision: review.decision,
      classification: classification.classification,
      validation_errors: errors,
      dedupe_match_lead_id: existingMatch,
      duplicate_of_row: inBatchRow,
    }),
    duplicate: { existing_lead_id: existingMatch, in_batch_row: inBatchRow },
  };
}
