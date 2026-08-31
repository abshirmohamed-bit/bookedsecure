// Tenant-scoped soft delete and restore for leads.
//
// SAFETY BOUNDARY: this module only ever UPDATEs the soft-delete columns on
// `public.leads` rows that belong to the caller's business, and writes a
// deletion-request record plus an audit event. It performs no DELETE, no
// cascade, no messaging-provider call, and never touches conversations,
// messages, jobs, notifications, webhook events, import batches, commit
// records or idempotency keys.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  normaliseSelection,
  planSoftDelete,
  type DeletableLead,
  type DeletionFailure,
  type DeletionResult,
} from "@/lib/lead-deletion";

type Client = SupabaseClient<Database>;

const LEAD_COLUMNS =
  "id, name, mobile_number, source_channel, lead_origin, source_metadata, import_batch_id, deleted_at, deleted_by, deletion_reason, deletion_request_id, created_at";

type RequestRow = {
  id: string;
  request_id: string;
  status: string;
  requested_count: number;
  deleted_count: number;
  failed_count: number;
  failures: unknown;
};

async function loadTenantLeads(
  client: Client,
  businessId: string,
  leadIds: string[],
): Promise<DeletableLead[]> {
  if (leadIds.length === 0) return [];
  const [{ data: leads }, { data: conversations }, { data: jobs }] = await Promise.all([
    client.from("leads").select(LEAD_COLUMNS).eq("business_id", businessId).in("id", leadIds),
    client
      .from("conversations")
      .select("lead_id, status, next_follow_up_at, automation_paused")
      .eq("business_id", businessId)
      .in("lead_id", leadIds),
    client
      .from("jobs")
      .select("lead_id, completion_status, completed_value")
      .eq("business_id", businessId)
      .in("lead_id", leadIds),
  ]);

  const conversationByLead = new Map((conversations ?? []).map((row) => [row.lead_id, row]));
  const jobByLead = new Map((jobs ?? []).map((row) => [row.lead_id, row]));
  return (leads ?? []).map((lead) => ({
    ...(lead as unknown as DeletableLead),
    conversation: conversationByLead.get(lead.id) ?? null,
    job: jobByLead.get(lead.id) ?? null,
  }));
}

function failuresOf(value: unknown): DeletionFailure[] {
  return Array.isArray(value) ? (value as DeletionFailure[]) : [];
}

/**
 * Soft-deletes the selected leads.
 *
 * Idempotent: replaying the same `requestId` returns the recorded outcome and
 * deletes nothing further. A request already `processing` is refused so two
 * concurrent requests cannot act on the same leads.
 */
export async function softDeleteLeads(
  client: Client,
  input: {
    businessId: string;
    actorUserId: string;
    requestId: string;
    leadIds: string[];
    reason?: string | null;
    allowProtected?: boolean;
  },
): Promise<DeletionResult> {
  const requestedIds = normaliseSelection(input.leadIds);
  const reason = input.reason?.trim() || null;

  const { data: existing } = (await client
    .from("lead_deletion_requests")
    .select("id, request_id, status, requested_count, deleted_count, failed_count, failures")
    .eq("business_id", input.businessId)
    .eq("request_id", input.requestId)
    .maybeSingle()) as { data: RequestRow | null };

  if (existing) {
    if (existing.status === "processing") {
      throw new Error("A deletion request for these leads is already processing.");
    }
    return {
      requestId: input.requestId,
      requested: existing.requested_count,
      deleted: existing.deleted_count,
      failed: existing.failed_count,
      failures: failuresOf(existing.failures),
      alreadyDeleted: 0,
      idempotentReplay: true,
    };
  }

  const { data: created, error: createError } = await client
    .from("lead_deletion_requests")
    .insert({
      business_id: input.businessId,
      request_id: input.requestId,
      actor_user_id: input.actorUserId,
      action: "soft_delete",
      reason,
      requested_lead_ids: requestedIds,
      requested_count: requestedIds.length,
      status: "processing",
    })
    .select("id")
    .single();
  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not open a deletion request.");
  }

  const tenantLeads = await loadTenantLeads(client, input.businessId, requestedIds);
  const plan = planSoftDelete({
    requestedIds,
    tenantLeads,
    ...(input.allowProtected === undefined ? {} : { allowProtected: input.allowProtected }),
  });

  const failures = [...plan.failures];
  let deleted = 0;

  if (plan.toDelete.length > 0) {
    const { data: updated, error } = await client
      .from("leads")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: input.actorUserId,
        deletion_reason: reason,
        deletion_request_id: input.requestId,
      })
      .eq("business_id", input.businessId)
      .is("deleted_at", null)
      .in("id", plan.toDelete)
      .select("id");
    if (error) {
      for (const leadId of plan.toDelete) {
        failures.push({ leadId, name: null, reason: "Database rejected the update" });
      }
    } else {
      deleted = (updated ?? []).length;
      const done = new Set((updated ?? []).map((row) => row.id));
      for (const leadId of plan.toDelete) {
        if (!done.has(leadId)) {
          failures.push({ leadId, name: null, reason: "Lead was not updated" });
        }
      }
    }
  }

  await client
    .from("lead_deletion_requests")
    .update({
      status: "completed",
      deleted_count: deleted,
      failed_count: failures.length,
      failures,
    })
    .eq("id", created.id);

  // Audit trail: ids and counts only — never phone numbers or message bodies.
  await client.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.actorUserId,
    event_type: "leads_soft_deleted",
    entity_type: "lead",
    entity_id: null,
    metadata: {
      request_id: input.requestId,
      selected_lead_ids: requestedIds,
      requested_count: requestedIds.length,
      deleted_count: deleted,
      failed_count: failures.length,
      already_deleted_count: plan.alreadyDeleted.length,
      deletion_reason: reason,
      allow_protected: Boolean(input.allowProtected),
    },
  });

  return {
    requestId: input.requestId,
    requested: requestedIds.length,
    deleted,
    failed: failures.length,
    failures,
    alreadyDeleted: plan.alreadyDeleted.length,
    idempotentReplay: false,
  };
}

/** Lists soft-deleted leads for the recovery view. Tenant-scoped, read-only. */
/** One tenant-scoped, paginated page of soft-deleted leads. Read-only. */
export async function listDeletedLeads(
  client: Client,
  businessId: string,
  pagination?: { page?: number; pageSize?: number },
) {
  const { queryLeadInbox } = await import("@/lib/lead-query.server");
  const result = await queryLeadInbox(client, {
    businessId,
    filters: { scope: "deleted" },
    page: pagination?.page ?? 1,
    pageSize: pagination?.pageSize ?? 25,
  });
  return result;
}


/**
 * Restores soft-deleted leads in place: the same row, id, source attribution,
 * import batch and metadata. Nothing is re-created, so no duplicates appear.
 */
export async function restoreLeads(
  client: Client,
  input: { businessId: string; actorUserId: string; leadIds: string[] },
): Promise<{ requested: number; restored: number; failures: DeletionFailure[] }> {
  const ids = normaliseSelection(input.leadIds);
  if (ids.length === 0) return { requested: 0, restored: 0, failures: [] };

  const { data: restored, error } = await client
    .from("leads")
    .update({
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null,
      deletion_request_id: null,
    })
    .eq("business_id", input.businessId)
    .not("deleted_at", "is", null)
    .in("id", ids)
    .select("id");
  if (error) throw new Error(error.message);

  const done = new Set((restored ?? []).map((row) => row.id));
  const failures = ids
    .filter((id) => !done.has(id))
    .map((leadId) => ({
      leadId,
      name: null,
      reason: "Not a deleted lead for this business",
    }));

  await client.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.actorUserId,
    event_type: "leads_restored",
    entity_type: "lead",
    entity_id: null,
    metadata: {
      selected_lead_ids: ids,
      requested_count: ids.length,
      restored_count: done.size,
      failed_count: failures.length,
    },
  });

  return { requested: ids.length, restored: done.size, failures };
}
