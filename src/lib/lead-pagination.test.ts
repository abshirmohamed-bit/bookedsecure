import { describe, expect, it } from "vitest";
import {
  buildPageMeta,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  leadFilterPredicates,
  normaliseFilters,
  normalisePageRequest,
  rangeFor,
  resolveRequestedPage,
  smsFilterPredicates,
} from "@/lib/lead-pagination";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";
import { queryLeadInbox } from "@/lib/lead-query.server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function lead(overrides: Record<string, unknown>) {
  return {
    business_id: TENANT,
    name: "Lead",
    mobile_number: "+61400000000",
    status: "new",
    source_channel: "meta",
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    last_outbound_sms_status: null,
    last_delivered_sms_at: null,
    last_reply_at: null,
    first_reply_at: null,
    sms_suppressed_at: null,
    ...overrides,
  };
}

/** 10 leads with identical timestamps: the id tie-breaker must keep paging stable. */
function tiedDb(count = 10): FakeDb {
  return {
    leads: Array.from({ length: count }, (_, index) =>
      lead({ id: `lead-${String(index).padStart(2, "0")}`, created_at: "2026-01-01T00:00:00Z" }),
    ),
    conversations: [],
    jobs: [],
  };
}

describe("page arithmetic", () => {
  it("uses a safe default page size and clamps hostile input", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(14);
    expect(clampPageSize(undefined)).toBe(14);
    expect(clampPageSize(0)).toBe(14);
    expect(clampPageSize(-5)).toBe(14);
    expect(clampPageSize(5000)).toBe(14);
    expect(normalisePageRequest({ page: -3, pageSize: 50 })).toEqual({ page: 1, pageSize: 14 });
  });

  it("maps pages to inclusive zero-based ranges", () => {
    expect(rangeFor({ page: 1, pageSize: 14 })).toEqual({ from: 0, to: 13 });
    expect(rangeFor({ page: 3, pageSize: 14 })).toEqual({ from: 28, to: 41 });
  });

  it("reports next/previous and the visible row range", () => {
    const meta = buildPageMeta({ page: 2, pageSize: 14, totalCount: 60, returned: 14 });
    expect(meta).toMatchObject({
      pageCount: 5,
      hasNextPage: true,
      hasPreviousPage: true,
      rangeFrom: 15,
      rangeTo: 28,
    });
    const last = buildPageMeta({ page: 5, pageSize: 14, totalCount: 60, returned: 4 });
    expect(last).toMatchObject({ hasNextPage: false, rangeFrom: 57, rangeTo: 60 });
  });

  it("renders an empty page without pretending rows exist", () => {
    const meta = buildPageMeta({ page: 1, pageSize: 25, totalCount: 0, returned: 0 });
    expect(meta).toMatchObject({
      totalCount: 0,
      pageCount: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      rangeFrom: 0,
      rangeTo: 0,
    });
  });

  it("never leaves the caller past the end of the filtered result", () => {
    expect(resolveRequestedPage(9, 30, 25)).toBe(2);
    expect(resolveRequestedPage(4, 0, 25)).toBe(1);
    expect(resolveRequestedPage(1, 500, 25)).toBe(1);
  });
});

describe("filter contract", () => {
  it("defaults unknown filter values instead of trusting them", () => {
    expect(normaliseFilters({ sms: "bogus" as never, scope: "deleted" })).toEqual({
      status: "all",
      source: "all",
      sms: "all",
      scope: "deleted",
    });
  });

  it("always constrains by tenant and lead scope", () => {
    const predicates = leadFilterPredicates(TENANT, normaliseFilters({ status: "new" }));
    expect(predicates[0]).toEqual({ kind: "eq", column: "business_id", value: TENANT });
    expect(predicates[1]).toEqual({ kind: "isNull", column: "deleted_at" });
    expect(predicates).toContainEqual({ kind: "eq", column: "status", value: "new" });
  });

  it("translates every SMS filter into database predicates", () => {
    expect(smsFilterPredicates("all")).toEqual([]);
    expect(smsFilterPredicates("sms_delivered")).toEqual([
      { kind: "eq", column: "last_outbound_sms_status", value: "delivered" },
    ]);
    expect(smsFilterPredicates("sms_suppressed")).toEqual([
      { kind: "notNull", column: "sms_suppressed_at" },
    ]);
    expect(smsFilterPredicates("no_reply_after_delivery")).toHaveLength(3);
  });
});

describe("queryLeadInbox", () => {
  it("requires a business context", async () => {
    await expect(queryLeadInbox(createFakeSupabase(tiedDb()), { businessId: "" })).rejects.toThrow(
      /business context/i,
    );
  });

  it("never returns another tenant's leads or counts them", async () => {
    const db = tiedDb(3);
    db["leads"]!.push(lead({ id: "foreign-1", business_id: OTHER }));
    const result = await queryLeadInbox(createFakeSupabase(db), { businessId: TENANT, pageSize: 25 });
    expect(result.page.totalCount).toBe(3);
    expect(result.leads.map((row) => row.id)).not.toContain("foreign-1");
  });

  it("applies filters before pagination", async () => {
    const db = tiedDb(0);
    db["leads"] = [
      lead({ id: "a", status: "new" }),
      lead({ id: "b", status: "completed" }),
      lead({ id: "c", status: "completed" }),
    ];
    const result = await queryLeadInbox(createFakeSupabase(db), {
      businessId: TENANT,
      filters: { status: "completed" },
      pageSize: 1,
    });
    expect(result.page.totalCount).toBe(2);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]!.status).toBe("completed");
  });

  it("pages stably with equal timestamps: no duplicates, no missing rows", async () => {
    const client = createFakeSupabase(tiedDb(10));
    const seen: string[] = [];
    for (const page of [1, 2, 3, 4]) {
      const result = await queryLeadInbox(client, { businessId: TENANT, page, pageSize: 3 });
      seen.push(...result.leads.map((row) => row.id));
    }
    expect(new Set(seen).size).toBe(10);
    expect(seen).toHaveLength(10);
  });

  it("clamps a page request past the end back to the last page", async () => {
    const result = await queryLeadInbox(createFakeSupabase(tiedDb(2)), {
      businessId: TENANT,
      page: 9,
      pageSize: 25,
    });
    expect(result.page).toMatchObject({ page: 1, totalCount: 2, hasNextPage: false });
    expect(result.leads).toHaveLength(2);
  });

  it("renders an empty page when no rows match the filters", async () => {
    const result = await queryLeadInbox(createFakeSupabase(tiedDb(2)), {
      businessId: TENANT,
      filters: { status: "completed" },
    });
    expect(result.leads).toEqual([]);
    expect(result.page).toMatchObject({ totalCount: 0, rangeFrom: 0, rangeTo: 0 });
  });

  it("filters by delivery status and suppression", async () => {
    const db = tiedDb(0);
    db["leads"] = [
      lead({ id: "delivered", last_outbound_sms_status: "delivered" }),
      lead({ id: "queued", last_outbound_sms_status: "queued" }),
      lead({ id: "suppressed", sms_suppressed_at: "2026-01-02T00:00:00Z" }),
    ];
    const client = createFakeSupabase(db);
    const delivered = await queryLeadInbox(client, {
      businessId: TENANT,
      filters: { sms: "sms_delivered" },
    });
    expect(delivered.leads.map((row) => row.id)).toEqual(["delivered"]);
    const pending = await queryLeadInbox(client, {
      businessId: TENANT,
      filters: { sms: "sms_pending" },
    });
    expect(pending.leads.map((row) => row.id)).toEqual(["queued"]);
    const suppressed = await queryLeadInbox(client, {
      businessId: TENANT,
      filters: { sms: "sms_suppressed" },
    });
    expect(suppressed.leads.map((row) => row.id)).toEqual(["suppressed"]);
  });

  it("keeps deleted leads out of the active scope and paginates them separately", async () => {
    const db = tiedDb(0);
    db["leads"] = [
      lead({ id: "live" }),
      lead({ id: "gone-1", deleted_at: "2026-02-01T00:00:00Z" }),
      lead({ id: "gone-2", deleted_at: "2026-02-02T00:00:00Z" }),
      lead({ id: "foreign-gone", business_id: OTHER, deleted_at: "2026-02-03T00:00:00Z" }),
    ];
    const client = createFakeSupabase(db);
    const active = await queryLeadInbox(client, { businessId: TENANT });
    expect(active.leads.map((row) => row.id)).toEqual(["live"]);
    const deleted = await queryLeadInbox(client, {
      businessId: TENANT,
      filters: { scope: "deleted" },
      pageSize: 1,
    });
    expect(deleted.page.totalCount).toBe(2);
    expect(deleted.leads.map((row) => row.id)).toEqual(["gone-2"]);
  });

  it("loads conversation and job context in the same query (no N+1)", async () => {
    const db = tiedDb(0);
    db["leads"] = [lead({ id: "with-context" })];
    db["conversations"] = [
      {
        id: "conv-1",
        lead_id: "with-context",
        business_id: TENANT,
        status: "active",
        last_message_at: "2026-03-01T00:00:00Z",
      },
    ];
    db["jobs"] = [
      {
        id: "job-1",
        lead_id: "with-context",
        business_id: TENANT,
        completion_status: "completed",
        completed_value: 320,
        completed_at: "2026-03-02T00:00:00Z",
      },
    ];
    const client = createFakeSupabase(db);
    const result = await queryLeadInbox(client, { businessId: TENANT });
    expect(result.leads[0]!.conversation?.last_message_at).toBe("2026-03-01T00:00:00Z");
    expect(result.leads[0]!.job?.completed_value).toBe(320);
    expect(result.leads[0]!.last_activity_at).toBe("2026-03-01T00:00:00Z");
    // Two statements only: one count, one page read.
    expect(client.writes.filter((entry: { op: string }) => entry.op !== "select")).toHaveLength(0);
  });

  it("leaves leads without a conversation visible", async () => {
    const db = tiedDb(0);
    db["leads"] = [lead({ id: "imported" })];
    const result = await queryLeadInbox(createFakeSupabase(db), { businessId: TENANT });
    expect(result.leads[0]!.conversation).toBeNull();
    expect(result.leads[0]!.job).toBeNull();
  });
});
