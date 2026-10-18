// Tenant-scoped soft delete and restore for leads.
//
// SAFETY BOUNDARY: this module only ever UPDATEs the soft-delete columns on
// `public.leads` rows that belong to the caller's business, and writes a
// deletion-request record plus an audit event. The database atomically cancels
// scheduled jobs and withdraws live offers when deleted_at is set; historical
// records remain. No messages are sent and no records are permanently deleted.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  normaliseSelection,
  planSoftDelete,
  type DeletableLead,
  type DeletionFailure,
  type DeletionResult,
} from "@/lib/lead-deletion";
import { DEFAULT_PAGE_SIZE } from "@/lib/lead-pagination";
import {
  authoritativeBookingState,
  bookingPreservationColumns,
  deletionBlockedByBooking,
  BOOKED_DELETION_BLOCK_REASON,
} from "@/lib/lead-deletion-booking";
import type { LeadBookingProjection, LeadBookingState } from "@/lib/booking-projection";

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

type BookingFacts = {
  offers: { lead_id: string; status: string | null }[];
  jobs: { lead_id: string; completion_status: string | null }[];
  /** Booking projection columns, per lead, read straight from `leads`. */
  projections: Map<string, LeadBookingState>;
};

const EMPTY_BOOKING_FACTS: BookingFacts = { offers: [], jobs: [], projections: new Map() };

/** Reads the AUTHORITATIVE booking tables, tenant-scoped and read-only. */
async function loadBookingFacts(
  client: Client,
  businessId: string,
  leadIds: string[],
): Promise<BookingFacts> {
  if (leadIds.length === 0) return EMPTY_BOOKING_FACTS;
  const [{ data: offers }, { data: jobs }, { data: leads }] = await Promise.all([
    client
      .from("booking_offers")
      .select("lead_id, status")
      .eq("business_id", businessId)
      .in("lead_id", leadIds),
    client
      .from("jobs")
      .select("lead_id, completion_status")
      .eq("business_id", businessId)
      .in("lead_id", leadIds),
    client
      .from("leads")
      .select("id, status, booking_status, quote_status, customer_status")
      .eq("business_id", businessId)
      .in("id", leadIds),
  ]);
  const projections = new Map<string, LeadBookingState>();
  for (const row of (leads ?? []) as unknown as (LeadBookingState & { id: string })[]) {
    projections.set(row.id, {
      status: String(row.status ?? "new"),
      booking_status: String(row.booking_status ?? "none"),
      quote_status: String(row.quote_status ?? "in_progress"),
      customer_status: String(row.customer_status ?? "prospect"),
    });
  }
  return {
    offers: (offers ?? []) as BookingFacts["offers"],
    jobs: (jobs ?? []) as BookingFacts["jobs"],
    projections,
  };
}

/** Booked leads keep their scheduled projection; unbooked leads are untouched. */
function preservationFor(leadId: string, facts: BookingFacts): LeadBookingProjection | null {
  const authoritative = authoritativeBookingState({
    leadId,
    offers: facts.offers,
    jobs: facts.jobs,
  });
  const current =
    facts.projections.get(leadId) ??
    ({
      status: "new",
      booking_status: "none",
      quote_status: "in_progress",
      customer_status: "prospect",
    } satisfies LeadBookingState);
  return bookingPreservationColumns(current, authoritative);
}

/**
 * Writes back the scheduled projection for every booked lead in `leadIds`.
 * Tenant- and lead-scoped, booking columns only. never consent, quote status,
 * owner review, offers, jobs, messages or automation.
 */
async function preserveBookingProjections(
  client: Client,
  businessId: string,
  leadIds: string[],
  facts: BookingFacts,
): Promise<void> {
  for (const leadId of leadIds) {
    const columns: LeadBookingProjection | null = preservationFor(leadId, facts);
    if (!columns) continue;
    await client
      .from("leads")
      .update(columns)
      .eq("business_id", businessId)
      .eq("id", leadId);
  }
}

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
    /** Product policy: refuse leads with a confirmed offer or scheduled job. */
    blockBookedLeads?: boolean;
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

  // Authoritative booking tables, not the lead's projection columns.
  const bookingFacts = await loadBookingFacts(client, input.businessId, plan.toDelete);

  const deletable: string[] = [];
  for (const leadId of plan.toDelete) {
    const authoritative = authoritativeBookingState({
      leadId,
      offers: bookingFacts.offers,
      jobs: bookingFacts.jobs,
    });
    if (
      deletionBlockedByBooking(
        authoritative,
        input.blockBookedLeads === undefined ? {} : { blockBookedLeads: input.blockBookedLeads },
      )
    ) {
      failures.push({
        leadId,
        name: tenantLeads.find((lead) => lead.id === leadId)?.name ?? null,
        reason: BOOKED_DELETION_BLOCK_REASON,
      });
      continue;
    }
    deletable.push(leadId);
  }

  if (deletable.length > 0) {
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
      .in("id", deletable)
      .select("id");
    if (error) {
      for (const leadId of deletable) {
        failures.push({ leadId, name: null, reason: "Database rejected the update" });
      }
    } else {
      deleted = (updated ?? []).length;
      const done = new Set((updated ?? []).map((row) => row.id));
      for (const leadId of deletable) {
        if (!done.has(leadId)) {
          failures.push({ leadId, name: null, reason: "Lead was not updated" });
        }
      }
      // The deletion trigger has released live bookings. Never reapply the
      // pre-delete facts here: that would undo its cancelled lead projection.
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

  // Audit trail: ids and counts only. never phone numbers or message bodies.
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
    pageSize: pagination?.pageSize ?? DEFAULT_PAGE_SIZE,
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

  // A restored lead keeps the booking projection its booking tables prove.
  const restoreFacts = await loadBookingFacts(client, input.businessId, Array.from(done));
  await preserveBookingProjections(client, input.businessId, Array.from(done), restoreFacts);

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
