// Pure pagination + filter contract for the tenant-scoped Lead Inbox.
//
// Everything here is deterministic and I/O free so the server query, the UI and
// the tests share exactly the same page arithmetic and filter semantics.

import { SMS_LEAD_FILTERS, type SmsLeadFilter } from "@/lib/sms/delivery";

export const DEFAULT_PAGE_SIZE = 14;
export const PAGE_SIZE_OPTIONS = [14] as const;
export const MAX_PAGE_SIZE = 14;

export type LeadScope = "active" | "deleted";

export type LeadInboxFilters = {
  status: string;
  source: string;
  sms: SmsLeadFilter;
  scope: LeadScope;
};

export const DEFAULT_FILTERS: LeadInboxFilters = {
  status: "all",
  source: "all",
  sms: "all",
  scope: "active",
};

export type PageRequest = { page: number; pageSize: number };

export type PageMeta = {
  page: number;
  pageSize: number;
  /** Total rows matching the tenant-scoped filters, before pagination. */
  totalCount: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** 1-based inclusive row range shown on this page; zeros when empty. */
  rangeFrom: number;
  rangeTo: number;
};

function toInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function clampPageSize(value: unknown): number {
  const size = toInteger(value, DEFAULT_PAGE_SIZE);
  if (size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}

export function clampPage(value: unknown): number {
  const page = toInteger(value, 1);
  return page < 1 ? 1 : page;
}

export function normalisePageRequest(input?: Partial<PageRequest> | null): PageRequest {
  return { page: clampPage(input?.page), pageSize: clampPageSize(input?.pageSize) };
}

/** Inclusive zero-based range for a Postgres/PostgREST `.range(from, to)` call. */
export function rangeFor(request: PageRequest): { from: number; to: number } {
  const { page, pageSize } = normalisePageRequest(request);
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function buildPageMeta(input: {
  page: number;
  pageSize: number;
  totalCount: number;
  returned: number;
}): PageMeta {
  const pageSize = clampPageSize(input.pageSize);
  const totalCount = Math.max(0, toInteger(input.totalCount, 0));
  const pageCount = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const page = clampPage(input.page);
  const returned = Math.max(0, toInteger(input.returned, 0));
  const rangeFrom = returned === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = returned === 0 ? 0 : rangeFrom + returned - 1;
  return {
    page,
    pageSize,
    totalCount,
    pageCount,
    hasNextPage: page * pageSize < totalCount,
    hasPreviousPage: page > 1,
    rangeFrom,
    rangeTo,
  };
}

/**
 * The page a request should land on after a filter change or a deletion:
 * never past the end of the filtered result, never below 1.
 */
export function resolveRequestedPage(requested: number, totalCount: number, pageSize: number): number {
  const page = clampPage(requested);
  const size = clampPageSize(pageSize);
  const pageCount = totalCount === 0 ? 1 : Math.ceil(totalCount / size);
  return Math.min(page, pageCount);
}

export function normaliseFilters(input?: Partial<LeadInboxFilters> | null): LeadInboxFilters {
  const sms = input?.sms;
  return {
    status: typeof input?.status === "string" && input.status ? input.status : "all",
    source: typeof input?.source === "string" && input.source ? input.source : "all",
    sms: sms && (SMS_LEAD_FILTERS as readonly string[]).includes(sms) ? sms : "all",
    scope: input?.scope === "deleted" ? "deleted" : "active",
  };
}

export function filtersAreEqual(a: LeadInboxFilters, b: LeadInboxFilters): boolean {
  return a.status === b.status && a.source === b.source && a.sms === b.sms && a.scope === b.scope;
}

// ---------------------------------------------------------------------------
// Filter -> database predicate translation
// ---------------------------------------------------------------------------

export type LeadPredicate =
  | { kind: "eq"; column: string; value: string }
  | { kind: "in"; column: string; values: string[] }
  | { kind: "isNull"; column: string }
  | { kind: "notNull"; column: string };

/** Pending outbound states, mirrored from the delivery state model. */
export const PENDING_SMS_STATUSES = ["queued", "provider_accepted", "sent", "unknown"] as const;

/**
 * Every inbox filter, expressed as database predicates. These are applied
 * BEFORE pagination, in addition to the mandatory tenant predicate.
 */
export function smsFilterPredicates(filter: SmsLeadFilter): LeadPredicate[] {
  switch (filter) {
    case "sms_delivered":
      return [{ kind: "eq", column: "last_outbound_sms_status", value: "delivered" }];
    case "sms_pending":
      return [{ kind: "in", column: "last_outbound_sms_status", values: [...PENDING_SMS_STATUSES] }];
    case "sms_failed":
      return [{ kind: "eq", column: "last_outbound_sms_status", value: "failed" }];
    case "sms_undelivered":
      return [{ kind: "eq", column: "last_outbound_sms_status", value: "undelivered" }];
    case "sms_suppressed":
      return [{ kind: "notNull", column: "sms_suppressed_at" }];
    case "no_reply_after_delivery":
      return [
        { kind: "notNull", column: "last_delivered_sms_at" },
        { kind: "isNull", column: "last_reply_at" },
        { kind: "isNull", column: "first_reply_at" },
      ];
    case "all":
    default:
      return [];
  }
}

export function leadFilterPredicates(businessId: string, filters: LeadInboxFilters): LeadPredicate[] {
  const predicates: LeadPredicate[] = [
    // Mandatory tenant boundary: always first, always present.
    { kind: "eq", column: "business_id", value: businessId },
    filters.scope === "deleted"
      ? { kind: "notNull", column: "deleted_at" }
      : { kind: "isNull", column: "deleted_at" },
  ];
  if (filters.status !== "all") predicates.push({ kind: "eq", column: "status", value: filters.status });
  if (filters.source !== "all")
    predicates.push({ kind: "eq", column: "source_channel", value: filters.source });
  predicates.push(...smsFilterPredicates(filters.sms));
  return predicates;
}

/** Deterministic total ordering: newest activity first, lead id as tie-breaker. */
export const LEAD_ORDER: { column: string; ascending: boolean }[] = [
  { column: "last_activity_at", ascending: false },
  { column: "id", ascending: false },
];

export const DELETED_LEAD_ORDER: { column: string; ascending: boolean }[] = [
  { column: "deleted_at", ascending: false },
  { column: "id", ascending: false },
];

export function orderFor(scope: LeadScope) {
  return scope === "deleted" ? DELETED_LEAD_ORDER : LEAD_ORDER;
}
