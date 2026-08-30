// Server-side CRM import commit gate.
//
// SAFETY BOUNDARY: every function in this module except `commitCanaryRow` is
// READ-ONLY against live data. It selects from import_batches,
// lead_import_rows and leads only. `commitCanaryRow` delegates to the
// import-only path in import-lead.server.ts, which creates exactly one live
// lead row plus its preview linkage and an audit record. Nothing here inserts
// conversations, messages, jobs, automation_jobs or pipeline state, calls a
// messaging provider (Telnyx, Sinch), or uses `captureLead`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  COMMITTABLE_BATCH_STATUSES,
  buildCommitSimulation,
  commitIdempotencyKey,
  evaluateCommitEligibility,
  readCommitState,
  type CanaryOutcome,
  type CommitEvaluableRow,
  type CommitSimulation,
} from "@/lib/commit-gate";
import { readClassification, readReview } from "@/lib/row-review";

type Client = SupabaseClient<Database>;

export type StagedCommitRow = CommitEvaluableRow;

export type CommitCandidateSet = {
  batch: { id: string; status: string; committable: boolean };
  rows: StagedCommitRow[];
};

/**
 * Tenant-scoped, read-only load of one staged batch and its rows.
 * A batch belonging to another business is simply not visible.
 */
export async function loadCommitRows(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<CommitCandidateSet | null> {
  const { data: batch } = await client
    .from("import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) return null;

  const { data: rows } = await client
    .from("lead_import_rows")
    .select("row_number, normalized_payload, validation_errors, dedupe_match_lead_id, resulting_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .order("row_number", { ascending: true });

  const mapped: StagedCommitRow[] = (rows ?? [])
    .filter((row) => row.row_number > 0)
    .map((row) => {
      const payload = (row.normalized_payload ?? {}) as Record<string, unknown>;
      const commit = readCommitState(payload);
      const liveLeadId =
        typeof row.resulting_lead_id === "string" ? row.resulting_lead_id : commit.lead_id;
      return {
        row_number: row.row_number,
        name: (payload["name"] as string | null) ?? null,
        mobile_number: (payload["mobile_number"] as string | null) ?? null,
        email: (payload["email"] as string | null) ?? null,
        validation_errors: (row.validation_errors ?? []) as StagedCommitRow["validation_errors"],
        dedupe_match_lead_id: row.dedupe_match_lead_id,
        duplicate_of_row: (payload["duplicate_of_row"] as number | null) ?? null,
        review: readReview(payload),
        classification: readClassification(payload),
        commit: {
          ...commit,
          lead_id: liveLeadId,
          status: liveLeadId ? "committed" : commit.status,
        },
      };
    });

  return {
    batch: {
      id: batch.id,
      status: batch.status,
      committable: (COMMITTABLE_BATCH_STATUSES as readonly string[]).includes(batch.status),
    },
    rows: mapped,
  };
}

/** Read-only commit simulation. Creates and changes nothing. */
export async function simulateCommit(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<
  | { status: "unavailable" }
  | { status: "batch_already_committed" }
  | { status: "ok"; simulation: CommitSimulation }
> {
  const loaded = await loadCommitRows(client, businessId, batchId);
  if (!loaded) return { status: "unavailable" };
  if (!loaded.batch.committable) return { status: "batch_already_committed" };
  return { status: "ok", simulation: buildCommitSimulation(batchId, loaded.rows) };
}

export type Revalidation =
  | { ok: true; row: StagedCommitRow; idempotencyKey: string }
  | { ok: false; outcome: CanaryOutcome };

/**
 * Final pre-commit revalidation for exactly one candidate row.
 *
 * Fails closed: any uncertainty (missing batch/row, changed state, duplicate
 * lookup error, already-used idempotency key) blocks the commit. Read-only and
 * tenant-scoped — the browser-supplied ids are only ever used inside filters
 * that are pinned to the authenticated business.
 */
export async function revalidateCandidate(
  client: Client,
  businessId: string,
  batchId: string,
  rowNumber: number,
): Promise<Revalidation> {
  const loaded = await loadCommitRows(client, businessId, batchId);
  if (!loaded) {
    return {
      ok: false,
      outcome: { status: "blocked", reasons: ["foreign_tenant"], detail: "Batch not found for this business." },
    };
  }
  if (!loaded.batch.committable) {
    return {
      ok: false,
      outcome: {
        status: "blocked",
        reasons: ["batch_already_committed"],
        detail: "This upload is no longer in an uncommitted staging state.",
      },
    };
  }
  const row = loaded.rows.find((entry) => entry.row_number === rowNumber);
  if (!row) {
    return {
      ok: false,
      outcome: { status: "blocked", reasons: ["row_not_found"], detail: "Preview row no longer exists." },
    };
  }
  if (row.commit?.status === "committed" || row.commit?.lead_id) {
    return {
      ok: false,
      outcome: { status: "already_committed", row_number: rowNumber, lead_id: row.commit?.lead_id ?? null },
    };
  }

  const eligibility = evaluateCommitEligibility(batchId, row);
  if (!eligibility.eligible) {
    return {
      ok: false,
      outcome: {
        status: "blocked",
        reasons: eligibility.reasons,
        detail: "This row is no longer eligible. Re-run preview and duplicate preflight.",
      },
    };
  }

  // Fresh, read-only duplicate recheck against live leads for this tenant only.
  const { loadExistingIndex } = await import("@/lib/csv-import.server");
  const lookup = await loadExistingIndex(client, businessId);
  if (lookup.state !== "checked") {
    return {
      ok: false,
      outcome: {
        status: "blocked",
        reasons: ["duplicate_lookup_error"],
        detail: "The duplicate lookup could not be verified, so nothing was committed.",
      },
    };
  }
  const phoneMatch = row.mobile_number ? lookup.index.byPhone.get(row.mobile_number) : undefined;
  const emailKey = (row.email ?? "").trim().toLowerCase();
  const emailMatch = emailKey ? lookup.index.byEmail.get(emailKey) : undefined;
  const existing = phoneMatch ?? emailMatch;
  if (existing) {
    return {
      ok: false,
      outcome: { status: "potential_duplicate", row_number: rowNumber, existing_lead_id: existing },
    };
  }

  // Idempotency key must not already be recorded against a live lead.
  const idempotencyKey = commitIdempotencyKey(batchId, rowNumber);
  const { data: existingByKey, error: keyError } = await client
    .from("leads")
    .select("id")
    .eq("business_id", businessId)
    .eq("external_id", idempotencyKey)
    .maybeSingle();
  if (keyError) {
    return {
      ok: false,
      outcome: {
        status: "blocked",
        reasons: ["state_changed"],
        detail: "Could not verify the idempotency key, so nothing was committed.",
      },
    };
  }
  if (existingByKey?.id) {
    return {
      ok: false,
      outcome: { status: "already_committed", row_number: rowNumber, lead_id: existingByKey.id },
    };
  }

  return { ok: true, row, idempotencyKey };
}

/**
 * Canary commit entry point.
 *
 * The project's inbound path (`captureLead` in lead-engine.server.ts) has
 * downstream side effects that cannot be disabled — it opens a conversation,
 * queues and runs an owner alert, and sends an acknowledgement SMS. It is
 * therefore NOT used here. Instead this delegates to the dedicated import-only
 * path in `import-lead.server.ts`, which creates exactly one live lead row plus
 * its preview linkage and an audit record: no conversation, no message, no
 * notification, no job, no automation and no provider call.
 */
export const CANARY_BLOCKED_DETAIL =
  "The inbound lead path (captureLead) also opens a conversation, runs an owner alert job and sends an acknowledgement SMS, so it is never used for imports. The import-only path creates the live lead record alone.";

export async function commitCanaryRow(
  client: Client,
  businessId: string,
  batchId: string,
  rowNumber: number,
): Promise<CanaryOutcome> {
  const revalidated = await revalidateCandidate(client, businessId, batchId, rowNumber);
  if (!revalidated.ok) return revalidated.outcome;
  const { importStagedRowAsLead } = await import("@/lib/import-lead.server");
  return importStagedRowAsLead(client, {
    businessId,
    batchId,
    rowNumber,
    idempotencyKey: revalidated.idempotencyKey,
  });
}

