// The single tenant-scoped, paginated Lead Inbox query.
//
// SAFETY BOUNDARY: read-only. Every query goes through `lead_inbox_rows`, is
// constrained by the caller's business_id, applies all filters BEFORE
// pagination, and fetches conversation + job context in the same round trip
// (the view left-joins them), so there is no N+1 and no cross-tenant read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  buildPageMeta,
  DEFAULT_PAGE_SIZE,
  leadFilterPredicates,
  normaliseFilters,
  normalisePageRequest,
  orderFor,
  rangeFor,
  resolveRequestedPage,
  type LeadInboxFilters,
  type LeadPredicate,
  type PageMeta,
} from "@/lib/lead-pagination";

type Client = SupabaseClient<Database>;

export const LEAD_INBOX_COLUMNS = [
  "id",
  "name",
  "mobile_number",
  "email",
  "suburb",
  "service_address",
  "vehicle_type",
  "service_intent",
  "source_channel",
  "source_campaign",
  "lead_origin",
  "source_metadata",
  "import_batch_id",
  "status",
  "readiness_classification",
  "created_at",
  "updated_at",
  "first_contacted_at",
  "first_reply_at",
  "deleted_at",
  "deleted_by",
  "deletion_reason",
  "deletion_request_id",
  "last_outbound_sms_status",
  "last_outbound_sms_at",
  "last_delivered_sms_at",
  "last_sms_failure_at",
  "last_sms_failure_reason",
  "last_sms_failure_code",
  "sms_suppressed_at",
  "sms_suppression_reason",
  "last_reply_at",
  "reachability_state",
  "reachability_evidence",
  "reachability_evidence_at",
  "last_successful_delivery_at",
  "last_permanent_failure_at",
  "last_inbound_reply_at",
  "last_activity_at",
  "conversation_id",
  "conversation_status",
  "conversation_next_follow_up_at",
  "conversation_automation_paused",
  "conversation_last_message_at",
  "job_id",
  "job_completion_status",
  "job_completed_value",
].join(", ");

type Nullable = string | null;

/** Serializable inbox row contract returned to the browser. */
export type LeadInboxRow = {
  id: string;
  name: string;
  mobile_number: string;
  email: Nullable;
  suburb: Nullable;
  service_address: Nullable;
  vehicle_type: Nullable;
  service_intent: Nullable;
  source_channel: string;
  source_campaign: Nullable;
  lead_origin: Nullable;
  source_metadata: Json | null;
  import_batch_id: Nullable;
  status: string;
  readiness_classification: Nullable;
  created_at: string;
  updated_at: Nullable;
  first_contacted_at: Nullable;
  first_reply_at: Nullable;
  deleted_at: Nullable;
  deleted_by: Nullable;
  deletion_reason: Nullable;
  deletion_request_id: Nullable;
  last_outbound_sms_status: Nullable;
  last_outbound_sms_at: Nullable;
  last_delivered_sms_at: Nullable;
  last_sms_failure_at: Nullable;
  last_sms_failure_reason: Nullable;
  last_sms_failure_code: Nullable;
  sms_suppressed_at: Nullable;
  sms_suppression_reason: Nullable;
  last_reply_at: Nullable;
  reachability_state: Nullable;
  reachability_evidence: Nullable;
  reachability_evidence_at: Nullable;
  last_successful_delivery_at: Nullable;
  last_permanent_failure_at: Nullable;
  last_inbound_reply_at: Nullable;
  last_activity_at: Nullable;
  conversation: {
    id: Nullable;
    status: Nullable;
    next_follow_up_at: Nullable;
    automation_paused: boolean | null;
    last_message_at: Nullable;
  } | null;
  job: { id: Nullable; completion_status: Nullable; completed_value: number | null } | null;
};

export type LeadInboxPage = { leads: LeadInboxRow[]; page: PageMeta; filters: LeadInboxFilters };

/** Reshapes a flat view row back into the inbox row contract the UI consumes. */
export function shapeLeadRow(row: Record<string, unknown>): LeadInboxRow {
  const {
    conversation_id,
    conversation_status,
    conversation_next_follow_up_at,
    conversation_automation_paused,
    conversation_last_message_at,
    job_id,
    job_completion_status,
    job_completed_value,
    ...lead
  } = row;

  return {
    ...(lead as Omit<LeadInboxRow, "conversation" | "job">),
    id: String(row["id"]),
    created_at: String(row["created_at"]),
    last_activity_at: (row["last_activity_at"] as string | null) ?? null,
    conversation:
      conversation_id == null && conversation_last_message_at == null && conversation_status == null
        ? null
        : {
            id: (conversation_id as string | null) ?? null,
            status: (conversation_status as string | null) ?? null,
            next_follow_up_at: (conversation_next_follow_up_at as string | null) ?? null,
            automation_paused: (conversation_automation_paused as boolean | null) ?? null,
            last_message_at: (conversation_last_message_at as string | null) ?? null,
          },
    job:
      job_id == null && job_completion_status == null
        ? null
        : {
            id: (job_id as string | null) ?? null,
            completion_status: (job_completion_status as string | null) ?? null,
            completed_value:
              job_completed_value == null ? null : Number(job_completed_value as number | string),
          },
  };
}

/** Applies the tenant + filter predicates to a query builder, before pagination. */
export function applyPredicates<T>(query: T, predicates: LeadPredicate[]): T {
  let builder = query as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const predicate of predicates) {
    switch (predicate.kind) {
      case "eq":
        builder = builder["eq"]!(predicate.column, predicate.value) as typeof builder;
        break;
      case "in":
        builder = builder["in"]!(predicate.column, predicate.values) as typeof builder;
        break;
      case "isNull":
        builder = builder["is"]!(predicate.column, null) as typeof builder;
        break;
      case "notNull":
        builder = builder["not"]!(predicate.column, "is", null) as typeof builder;
        break;
      case "search": {
        // Match name, mobile or email. PostgREST `.or` uses commas as syntax,
        // so strip the characters that could break or alter the pattern.
        const term = predicate.value.replace(/[%_,()."\\]/g, "").trim();
        if (term.length > 0) {
          builder = builder["or"]!(
            `name.ilike.%${term}%,mobile_number.ilike.%${term}%,email.ilike.%${term}%`,
          ) as typeof builder;
        }
        break;
      }
    }
  }
  return builder as unknown as T;
}

/**
 * Fetches one page of the caller's leads.
 *
 * `businessId` must come from the authenticated app context — never from the
 * browser. Ordering is a deterministic total order (activity desc, id desc), so
 * rows are never duplicated or skipped across pages when timestamps match.
 */
export async function queryLeadInbox(
  client: Client,
  input: {
    businessId: string;
    filters?: Partial<LeadInboxFilters> | null;
    page?: number;
    pageSize?: number;
  },
): Promise<LeadInboxPage> {
  if (!input.businessId) throw new Error("A business context is required to read leads.");

  const filters = normaliseFilters(input.filters);
  const requested = normalisePageRequest({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
  });
  const predicates = leadFilterPredicates(input.businessId, filters);

  // One round trip: PostgREST returns the exact total count alongside the page
  // of rows, so the inbox no longer pays for a separate counting query.
  async function fetchPage(page: number) {
    const { from, to } = rangeFor({ page, pageSize: requested.pageSize });
    let rowsQuery = applyPredicates(
      client.from("lead_inbox_rows").select(LEAD_INBOX_COLUMNS, { count: "exact" }),
      predicates,
    );
    for (const order of orderFor(filters.scope)) {
      rowsQuery = rowsQuery.order(order.column, { ascending: order.ascending, nullsFirst: false });
    }
    const { data, count, error } = await rowsQuery.range(from, to);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as unknown as Record<string, unknown>[], totalCount: count ?? 0 };
  }

  let page = requested.page;
  let result = await fetchPage(page);

  // A requested page past the end (filters changed, rows deleted) is clamped and
  // refetched, preserving the previous behaviour of never returning a blank page.
  const clamped = resolveRequestedPage(requested.page, result.totalCount, requested.pageSize);
  if (clamped !== page) {
    page = clamped;
    result = await fetchPage(page);
  }

  const leads = result.rows.map(shapeLeadRow);
  return {
    leads,
    filters,
    page: buildPageMeta({
      page,
      pageSize: requested.pageSize,
      totalCount: result.totalCount,
      returned: leads.length,
    }),
  };
}
