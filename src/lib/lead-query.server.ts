// The single tenant-scoped, paginated Lead Inbox query.
//
// SAFETY BOUNDARY: read-only. Every query goes through `lead_inbox_rows`, is
// constrained by the caller's business_id, applies all filters BEFORE
// pagination, and fetches conversation + job context in the same round trip
// (the view left-joins them), so there is no N+1 and no cross-tenant read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildPageMeta,
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

export type LeadInboxRow = Record<string, unknown> & {
  id: string;
  created_at: string;
  last_activity_at: string | null;
  conversation: {
    id: string | null;
    status: string | null;
    next_follow_up_at: string | null;
    automation_paused: boolean | null;
    last_message_at: string | null;
  } | null;
  job: { id: string | null; completion_status: string | null; completed_value: number | null } | null;
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
    ...(lead as Record<string, unknown>),
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
  const requested = normalisePageRequest({ page: input.page ?? 1, pageSize: input.pageSize ?? 25 });
  const predicates = leadFilterPredicates(input.businessId, filters);

  const countQuery = applyPredicates(
    client.from("lead_inbox_rows").select("id", { count: "exact", head: true }),
    predicates,
  );
  const { count, error: countError } = await countQuery;
  if (countError) throw new Error(countError.message);
  const totalCount = count ?? 0;

  const page = resolveRequestedPage(requested.page, totalCount, requested.pageSize);
  const { from, to } = rangeFor({ page, pageSize: requested.pageSize });

  let rowsQuery = applyPredicates(
    client.from("lead_inbox_rows").select(LEAD_INBOX_COLUMNS),
    predicates,
  );
  for (const order of orderFor(filters.scope)) {
    rowsQuery = rowsQuery.order(order.column, { ascending: order.ascending, nullsFirst: false });
  }
  const { data, error } = await rowsQuery.range(from, to);
  if (error) throw new Error(error.message);

  const leads = ((data ?? []) as unknown as Record<string, unknown>[]).map(shapeLeadRow);
  return {
    leads,
    filters,
    page: buildPageMeta({
      page,
      pageSize: requested.pageSize,
      totalCount,
      returned: leads.length,
    }),
  };
}
