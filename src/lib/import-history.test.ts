import { describe, expect, it, vi } from "vitest";
import {
  batchCountsLine,
  batchIdentityLine,
  canDeleteBatch,
  resolveSelectedBatchId,
  shortBatchId,
  type ImportBatchSummary,
} from "./import-history";
import { deletePreviewBatch, loadBatchPreview } from "./csv-import.server";

const GLOCAST = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const BATCH_A = "a1b2c3d4-0000-4000-8000-000000000001";
const BATCH_B = "b9c8d7e6-0000-4000-8000-000000000002";
const COMMITTED = "cccccccc-0000-4000-8000-000000000003";

function summary(overrides: Partial<ImportBatchSummary>): ImportBatchSummary {
  return {
    id: BATCH_A,
    filename: "bookedsecure-import-test.csv",
    status: "previewed",
    total_rows: 4,
    valid_rows: 2,
    invalid_rows: 2,
    duplicate_rows: 1,
    created_at: "2026-08-30T07:16:00.000Z",
    ...overrides,
  };
}

/**
 * Multi-batch fake of the admin client. Records every table/op so tests can
 * prove that only the two staging tables are ever written or deleted.
 */
function fakeClient() {
  const ops: { table: string; op: string; filters: Record<string, unknown> }[] = [];
  const batches: Record<string, unknown>[] = [
    {
      id: BATCH_A,
      business_id: GLOCAST,
      filename: "bookedsecure-import-test.csv",
      format: "crm",
      status: "previewed",
      total_rows: 2,
      valid_rows: 2,
      invalid_rows: 0,
      duplicate_rows: 0,
      created_at: "2026-08-30T07:16:00.000Z",
    },
    {
      id: BATCH_B,
      business_id: GLOCAST,
      filename: "bookedsecure-import-test.csv",
      format: "crm",
      status: "previewed",
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      duplicate_rows: 0,
      created_at: "2026-08-30T08:20:00.000Z",
    },
    {
      id: COMMITTED,
      business_id: GLOCAST,
      filename: "already-committed.csv",
      format: "crm",
      status: "committed",
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      duplicate_rows: 0,
      created_at: "2026-08-29T01:00:00.000Z",
    },
  ];
  const rows: Record<string, unknown>[] = [
    {
      id: "r1",
      batch_id: BATCH_A,
      business_id: GLOCAST,
      row_number: 1,
      raw_row: { Name: "Ada" },
      normalized_payload: { name: "Ada" },
      validation_errors: [],
      dedupe_match_lead_id: null,
      decision: "would_create",
    },
    {
      id: "r2",
      batch_id: BATCH_A,
      business_id: GLOCAST,
      row_number: 2,
      raw_row: { Name: "Bob" },
      normalized_payload: { name: "Bob" },
      validation_errors: [],
      dedupe_match_lead_id: null,
      decision: "would_create",
    },
    {
      id: "r3",
      batch_id: BATCH_B,
      business_id: GLOCAST,
      row_number: 1,
      raw_row: { Name: "Carl" },
      normalized_payload: { name: "Carl" },
      validation_errors: [],
      dedupe_match_lead_id: null,
      decision: "would_create",
    },
  ];

  const matches = (record: Record<string, unknown>, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([key, value]) => record[key] === value);

  const client = {
    ops,
    store: { batches, rows },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const source = () => (table === "import_batches" ? batches : table === "lead_import_rows" ? rows : []);

      const reader: Record<string, unknown> = {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return reader;
        },
        order: () => Promise.resolve({ data: source().filter((r) => matches(r, filters)), error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: source().find((r) => matches(r, filters)) ?? null, error: null }),
        single: () =>
          Promise.resolve({ data: source().find((r) => matches(r, filters)) ?? null, error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: source().filter((r) => matches(r, filters)), error: null }).then(
            resolve,
          ),
      };

      const deleter: Record<string, unknown> = {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return deleter;
        },
        then(resolve: (value: { error: null }) => unknown) {
          ops.push({ table, op: "delete", filters: { ...filters } });
          const list = source();
          for (let index = list.length - 1; index >= 0; index -= 1) {
            if (matches(list[index]!, filters)) list.splice(index, 1);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };

      return {
        select: () => reader,
        delete: () => deleter,
        insert: () => {
          ops.push({ table, op: "insert", filters: {} });
          return reader;
        },
        update: () => {
          ops.push({ table, op: "update", filters: {} });
          return reader;
        },
      } as never;
    },
  };
  return client;
}

describe("import history display identity", () => {
  it("shows two same-named uploads as distinct batches with their own id and timestamp", () => {
    const first = summary({ id: BATCH_A, created_at: "2026-08-30T07:16:00.000Z" });
    const second = summary({ id: BATCH_B, created_at: "2026-08-30T08:20:00.000Z" });

    expect(first.filename).toBe(second.filename);
    expect(shortBatchId(first.id)).toBe("#a1b2c3d4");
    expect(shortBatchId(second.id)).toBe("#b9c8d7e6");
    expect(batchIdentityLine(first)).not.toEqual(batchIdentityLine(second));
    expect(batchIdentityLine(first)).toContain("#a1b2c3d4");
  });

  it("summarises status, rows, issues and duplicates in plain language", () => {
    expect(batchCountsLine(summary({}))).toBe("Previewed · 4 rows · 2 issues · 1 duplicate");
    expect(batchCountsLine(summary({ status: "failed", total_rows: 1, invalid_rows: 1, duplicate_rows: 0 })))
      .toBe("Failed · 1 row · 1 issue · 0 duplicates");
  });

  it("selects the newest batch by default and preserves an explicit choice", () => {
    const list = [summary({ id: BATCH_B }), summary({ id: BATCH_A })];
    expect(resolveSelectedBatchId(list, null)).toBe(BATCH_B);
    expect(resolveSelectedBatchId(list, BATCH_A)).toBe(BATCH_A);
    // Selection that no longer exists (deleted) falls back to newest remaining.
    expect(resolveSelectedBatchId([summary({ id: BATCH_A })], BATCH_B)).toBe(BATCH_A);
    expect(resolveSelectedBatchId([], BATCH_B)).toBeNull();
  });

  it("only offers deletion for uncommitted statuses", () => {
    for (const status of ["uploaded", "previewed", "failed", "cancelled"]) {
      expect(canDeleteBatch(status)).toBe(true);
    }
    expect(canDeleteBatch("committed")).toBe(false);
  });
});

describe("selected batch preview isolation", () => {
  it("loads only the selected batch's rows and never mixes batches", async () => {
    const client = fakeClient();
    const a = await loadBatchPreview(client as never, GLOCAST, BATCH_A);
    const b = await loadBatchPreview(client as never, GLOCAST, BATCH_B);

    expect(a?.rows.map((row) => row.name)).toEqual(["Ada", "Bob"]);
    expect(b?.rows.map((row) => row.name)).toEqual(["Carl"]);
    expect(a?.batch.id).toBe(BATCH_A);
  });

  it("hides another tenant's batch", async () => {
    const client = fakeClient();
    expect(await loadBatchPreview(client as never, OTHER, BATCH_A)).toBeNull();
  });
});

describe("deletePreviewBatch (staging only)", () => {
  it("deletes only the selected batch and its staged rows", async () => {
    const client = fakeClient();
    const before = { batches: client.store.batches.length, rows: client.store.rows.length };

    const result = await deletePreviewBatch(client as never, GLOCAST, BATCH_A);

    expect(result).toMatchObject({ batchId: BATCH_A, deletedRows: 2 });
    expect(client.store.batches.length).toBe(before.batches - 1);
    expect(client.store.rows.length).toBe(before.rows - 2);
    // The duplicate-named sibling upload survives untouched.
    expect(client.store.batches.map((batch) => batch["id"])).toEqual([BATCH_B, COMMITTED]);
    expect(client.store.rows.map((row) => row["batch_id"])).toEqual([BATCH_B]);
    // Only staging tables were mutated.
    expect(new Set(client.ops.map((op) => op.table))).toEqual(
      new Set(["lead_import_rows", "import_batches"]),
    );
    expect(client.ops.every((op) => op.op === "delete")).toBe(true);
  });

  it("refuses to delete a committed batch and leaves everything in place", async () => {
    const client = fakeClient();
    await expect(deletePreviewBatch(client as never, GLOCAST, COMMITTED)).rejects.toThrow(
      /committed/i,
    );
    expect(client.store.batches.length).toBe(3);
    expect(client.store.rows.length).toBe(3);
    expect(client.ops).toHaveLength(0);
  });

  it("refuses a batch belonging to a different tenant", async () => {
    const client = fakeClient();
    await expect(deletePreviewBatch(client as never, OTHER, BATCH_A)).rejects.toThrow(/not found/i);
    expect(client.store.batches.length).toBe(3);
    expect(client.store.rows.length).toBe(3);
    expect(client.ops).toHaveLength(0);
  });

  it("never reads or writes live tables, sends messages or captures leads", async () => {
    const client = fakeClient();
    const captureLead = vi.fn();
    const sendSms = vi.fn();

    await deletePreviewBatch(client as never, GLOCAST, BATCH_B);

    const touched = client.ops.map((op) => op.table);
    for (const table of [
      "leads",
      "messages",
      "conversations",
      "jobs",
      "automation_jobs",
      "sms_senders",
      "automation_rules",
      "businesses",
    ]) {
      expect(touched).not.toContain(table);
    }
    expect(captureLead).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });
});
