// One-step, owner-confirmed contact import execution.
//
// SAFETY BOUNDARY: this module only creates leads through the import-only path
// in import-lead.server.ts and fills EMPTY fields on leads the tenant already
// has. It never sends a message, never creates a conversation, job, automation
// job or notification, never overwrites a value the tenant already has, and
// never touches another business's rows: every read and write is filtered by
// business_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { commitIdempotencyKey, readCommitState } from "@/lib/commit-gate";
import { importStagedRowAsLead } from "@/lib/import-lead.server";
import {
  buildSaveReport,
  planImport,
  type PlannableRow,
  type SaveReport,
  type SaveResultRow,
} from "@/lib/import-plan";

type Client = SupabaseClient<Database>;

/** Fields we may fill in on an existing lead — only when currently empty. */
const GAP_FILL_FIELDS = [
  "email",
  "email_normalised",
  "suburb",
  "service_address",
  "vehicle_type",
  "service_intent",
  "notes",
  "source_form",
] as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Fill only the empty fields of a lead the tenant already has, then link the
 * staged row to it so a repeat run reports "already there" instead of writing
 * again. Existing values, status, pipeline and messaging state are never changed.
 */
export async function fillLeadGapsFromStagedRow(
  client: Client,
  input: {
    businessId: string;
    batchId: string;
    rowNumber: number;
    leadId: string;
    payload: Record<string, unknown>;
  },
): Promise<{ outcome: "updated"; filled: string[] } | { outcome: "failed"; error: string }> {
  const { businessId, batchId, rowNumber, leadId, payload } = input;

  const { data: lead, error: leadError } = await client
    .from("leads")
    .select("id, email, email_normalised, suburb, service_address, vehicle_type, service_intent, notes, source_form")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (leadError || !lead) {
    return { outcome: "failed", error: leadError?.message ?? "The matching contact could not be read." };
  }

  const metadata = (payload["source_metadata"] ?? {}) as Record<string, unknown>;
  const incoming: Record<string, string | null> = {
    email: text(payload["email"]),
    email_normalised: text(payload["email_normalised"]) ?? text(payload["email"])?.toLowerCase() ?? null,
    suburb: text(metadata["suburb"]),
    service_address: text(metadata["service_address"]),
    vehicle_type: text(metadata["vehicle_type"]),
    service_intent: text(metadata["service_intent"]),
    notes: text(metadata["notes"]),
    source_form: text(payload["source_form"]) ?? text(metadata["form_name"]),
  };

  const update: Record<string, string> = {};
  const filled: string[] = [];
  for (const field of GAP_FILL_FIELDS) {
    const existing = text((lead as Record<string, unknown>)[field]);
    const value = incoming[field];
    if (!existing && value) {
      update[field] = value;
      filled.push(field);
    }
  }

  if (filled.length > 0) {
    const { error: updateError } = await client
      .from("leads")
      .update(update as never)
      .eq("id", leadId)
      .eq("business_id", businessId);
    if (updateError) return { outcome: "failed", error: updateError.message };
  }

  await client
    .from("lead_import_rows")
    .update({
      resulting_lead_id: leadId,
      normalized_payload: {
        ...payload,
        commit: {
          ...readCommitState(payload),
          status: "committed",
          idempotency_key: commitIdempotencyKey(batchId, rowNumber),
          lead_id: leadId,
          committed_at: new Date().toISOString(),
          error: null,
          reconciliation_required: false,
        },
      },
    } as never)
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .eq("row_number", rowNumber);

  await client.from("audit_events").insert({
    business_id: businessId,
    event_type: "crm_import_lead_gaps_filled",
    entity_type: "lead",
    entity_id: leadId,
    metadata: {
      batch_id: batchId,
      row_number: rowNumber,
      filled_fields: filled,
      import_only: true,
      messages_sent: 0,
    } as never,
  } as never);

  return { outcome: "updated", filled };
}

/**
 * Save one staged upload into the tenant's leads inbox in a single pass.
 * Re-derives the plan from freshly read rows, so a stale browser cannot cause
 * an unintended write, and is safe to re-run: saved rows come back as
 * "already there".
 */
export async function saveImportBatch(
  client: Client,
  input: { businessId: string; userId: string | null; batchId: string },
): Promise<
  | { status: "not_found" }
  | { status: "ok"; report: SaveReport }
> {
  const { businessId, batchId } = input;

  const { data: batch } = await client
    .from("import_batches")
    .select("id")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) return { status: "not_found" };

  const { data: rows } = await client
    .from("lead_import_rows")
    .select("row_number, normalized_payload, validation_errors, dedupe_match_lead_id, resulting_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const payloads = new Map<number, Record<string, unknown>>();
  const plannable: PlannableRow[] = (rows ?? [])
    .filter((row) => row.row_number > 0)
    .map((row) => {
      const payload = (row.normalized_payload ?? {}) as Record<string, unknown>;
      payloads.set(row.row_number, payload);
      const commit = readCommitState(payload);
      return {
        row_number: row.row_number,
        name: text(payload["name"]),
        mobile_number: text(payload["mobile_number"]),
        email: text(payload["email"]),
        validation_errors: (row.validation_errors ?? []) as { code: string }[],
        dedupe_match_lead_id: row.dedupe_match_lead_id,
        duplicate_of_row:
          typeof payload["duplicate_of_row"] === "number" ? (payload["duplicate_of_row"] as number) : null,
        commit_lead_id:
          typeof row.resulting_lead_id === "string" ? row.resulting_lead_id : commit.lead_id,
      };
    });

  const plan = planImport(batchId, plannable);
  const results: SaveResultRow[] = [];

  for (const planned of plan.rows) {
    const payload = payloads.get(planned.row_number) ?? {};
    if (planned.bucket === "already_there" || planned.bucket === "skip") {
      results.push({
        row_number: planned.row_number,
        name: planned.name,
        outcome: planned.bucket === "already_there" ? "already_there" : "skipped",
        detail: planned.skip_reason,
      });
      continue;
    }

    if (planned.bucket === "update" && planned.matched_lead_id) {
      const filled = await fillLeadGapsFromStagedRow(client, {
        businessId,
        batchId,
        rowNumber: planned.row_number,
        leadId: planned.matched_lead_id,
        payload,
      });
      results.push({
        row_number: planned.row_number,
        name: planned.name,
        outcome: filled.outcome === "updated" ? "updated" : "failed",
        detail: filled.outcome === "failed" ? filled.error : null,
      });
      continue;
    }

    const outcome = await importStagedRowAsLead(client, {
      businessId,
      batchId,
      rowNumber: planned.row_number,
      idempotencyKey: commitIdempotencyKey(batchId, planned.row_number),
    });
    if (outcome.status === "committed") {
      results.push({ row_number: planned.row_number, name: planned.name, outcome: "saved", detail: null });
    } else if (outcome.status === "already_committed") {
      results.push({
        row_number: planned.row_number,
        name: planned.name,
        outcome: "already_there",
        detail: null,
      });
    } else {
      results.push({
        row_number: planned.row_number,
        name: planned.name,
        outcome: "failed",
        detail: "error" in outcome ? (outcome.error ?? null) : null,
      });
    }
  }

  const report = buildSaveReport(results);

  await client.from("audit_events").insert({
    business_id: businessId,
    user_id: input.userId,
    event_type: "crm_import_batch_saved",
    entity_type: "import_batch",
    entity_id: batchId,
    metadata: {
      saved: report.saved,
      updated: report.updated,
      already_there: report.already_there,
      skipped: report.skipped,
      failed: report.failed,
      import_only: true,
      messages_sent: 0,
    } as never,
  } as never);

  return { status: "ok", report };
}
