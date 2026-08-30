// Import-only lead creation path for the CRM importer.
//
// SAFETY BOUNDARY: this module creates exactly ONE live lead row plus its
// preview-row linkage and an audit record. It never inserts a conversation,
// message, notification, automation job or job row, never changes pipeline
// state beyond the lead's own imported status, and never calls a messaging
// provider (Telnyx, Sinch) or `captureLead`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CanaryOutcome } from "@/lib/commit-gate";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";

type Client = SupabaseClient<Database>;

/** Marks a lead as historical CRM data rather than a live inbound enquiry. */
export const IMPORT_LEAD_ORIGIN = "crm_import";

export type StagedLeadPayload = {
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  email_normalised: string | null;
  source_channel?: string | null;
  source_channel_raw?: string | null;
  source_form?: string | null;
  proposed_status?: string | null;
  proposed_created_at?: string | null;
  source_metadata?: Record<string, unknown> | null;
};

export type ImportLeadInsert = {
  business_id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  email_normalised: string | null;
  suburb: string | null;
  vehicle_type: string | null;
  service_intent: string | null;
  source_channel: string;
  source_campaign: string | null;
  source_form: string | null;
  status: LeadStatus;
  readiness_classification: string | null;
  lead_origin: string;
  external_id: string;
  import_batch_id: string;
  source_metadata: Record<string, unknown>;
  notes: string | null;
  created_at?: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Pure mapping from a staged preview payload to the live lead row.
 * Deliberately produces no conversation, message, job or automation fields.
 */
export function buildImportLeadInsert(input: {
  businessId: string;
  batchId: string;
  rowNumber: number;
  idempotencyKey: string;
  payload: StagedLeadPayload;
  rawRow?: Record<string, unknown> | null;
}): ImportLeadInsert {
  const { payload } = input;
  const metadata = { ...(payload.source_metadata ?? {}) } as Record<string, unknown>;
  const proposed = text(payload.proposed_status);
  const status: LeadStatus =
    proposed && (LEAD_STATUSES as readonly string[]).includes(proposed)
      ? (proposed as LeadStatus)
      : "new";

  const insert: ImportLeadInsert = {
    business_id: input.businessId,
    name: text(payload.name) ?? "Imported lead",
    mobile_number: text(payload.mobile_number) ?? "",
    email: text(payload.email),
    email_normalised: text(payload.email_normalised) ?? text(payload.email)?.toLowerCase() ?? null,
    suburb: text(metadata["suburb"]),
    vehicle_type: text(metadata["vehicle_type"]),
    service_intent: text(metadata["service_intent"]),
    source_channel: text(payload.source_channel) ?? "unknown",
    source_campaign: text(metadata["source_campaign"]) ?? text(metadata["campaign_name"]),
    source_form: text(payload.source_form) ?? text(metadata["form_name"]),
    status,
    readiness_classification: null,
    lead_origin: IMPORT_LEAD_ORIGIN,
    external_id: input.idempotencyKey,
    import_batch_id: input.batchId,
    source_metadata: {
      ...metadata,
      import: {
        origin: IMPORT_LEAD_ORIGIN,
        batch_id: input.batchId,
        row_number: input.rowNumber,
        idempotency_key: input.idempotencyKey,
        source_channel_raw: text(payload.source_channel_raw),
        raw_row: input.rawRow ?? null,
      },
    },
    notes: null,
  };

  const createdAt = text(payload.proposed_created_at);
  if (createdAt) insert.created_at = createdAt;
  return insert;
}

/**
 * Import-only commit for exactly one already-revalidated staged row.
 *
 * The caller MUST have run `revalidateCandidate` first: this function assumes
 * tenant ownership, eligibility, duplicate status and idempotency have all been
 * verified, and it fails closed on any write error.
 */
export async function importStagedRowAsLead(
  client: Client,
  input: { businessId: string; batchId: string; rowNumber: number; idempotencyKey: string },
): Promise<CanaryOutcome> {
  const { businessId, batchId, rowNumber, idempotencyKey } = input;

  const { data: staged, error: stagedError } = await client
    .from("lead_import_rows")
    .select("normalized_payload, raw_row, resulting_lead_id")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .eq("row_number", rowNumber)
    .maybeSingle();

  if (stagedError || !staged) {
    return {
      status: "blocked",
      reasons: ["row_not_found"],
      detail: "The staged row could not be re-read, so nothing was written.",
    };
  }
  if (staged.resulting_lead_id) {
    return { status: "already_committed", row_number: rowNumber, lead_id: staged.resulting_lead_id };
  }

  const payload = (staged.normalized_payload ?? {}) as StagedLeadPayload & Record<string, unknown>;
  const insert = buildImportLeadInsert({
    businessId,
    batchId,
    rowNumber,
    idempotencyKey,
    payload,
    rawRow: (staged.raw_row ?? null) as Record<string, unknown> | null,
  });

  const attemptedAt = new Date().toISOString();
  const { data: lead, error: insertError } = await client
    .from("leads")
    .insert(insert as never)
    .select("id")
    .single();

  if (insertError || !lead?.id) {
    // Fail closed: record the failure on the preview row only, never mark committed.
    await client
      .from("lead_import_rows")
      .update({
        normalized_payload: {
          ...payload,
          commit: {
            status: "failed",
            idempotency_key: idempotencyKey,
            lead_id: null,
            committed_at: null,
            attempted_at: attemptedAt,
            error: insertError?.message ?? "Lead creation failed",
            reconciliation_required: false,
          },
        },
      } as never)
      .eq("batch_id", batchId)
      .eq("business_id", businessId)
      .eq("row_number", rowNumber);
    return {
      status: "failed",
      row_number: rowNumber,
      error: insertError?.message ?? "Lead creation failed",
    };
  }

  const committedAt = new Date().toISOString();
  const { error: linkError } = await client
    .from("lead_import_rows")
    .update({
      resulting_lead_id: lead.id,
      normalized_payload: {
        ...payload,
        commit: {
          status: "committed",
          idempotency_key: idempotencyKey,
          lead_id: lead.id,
          committed_at: committedAt,
          attempted_at: attemptedAt,
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
    event_type: linkError ? "crm_import_lead_reconciliation_required" : "crm_import_lead_created",
    entity_type: "lead",
    entity_id: lead.id,
    metadata: {
      batch_id: batchId,
      row_number: rowNumber,
      idempotency_key: idempotencyKey,
      lead_origin: IMPORT_LEAD_ORIGIN,
      import_only: true,
      conversation_created: false,
      messages_sent: 0,
      link_error: linkError?.message ?? null,
    } as never,
  } as never);

  if (linkError) {
    return {
      status: "reconciliation_required",
      row_number: rowNumber,
      lead_id: lead.id,
      error: `The live lead was created but the preview row could not be updated: ${linkError.message}. Reconcile manually — do not retry the import for this row.`,
    };
  }

  return { status: "committed", row_number: rowNumber, lead_id: lead.id, idempotency_key: idempotencyKey };
}
