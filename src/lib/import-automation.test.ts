import { describe, expect, it } from "vitest";
import {
  BOUNDED_BATCH_MAX_ROWS,
  DEFAULT_IMPORT_AUTOMATION_STATE,
  DEFAULT_IMPORT_MODE,
  buildImportSummary,
  evaluateBoundedBatchGate,
  evaluateCanaryGate,
  evaluateExceptionOnlyGate,
  evaluateModeTransition,
  limitBoundedBatch,
  readImportAutomationState,
  type ImportAutomationState,
} from "@/lib/import-automation";
import {
  changeImportMode,
  loadAutomationState,
  runBoundedBatch,
  runExceptionOnlyImport,
  setImportPaused,
  verifyCanaryImport,
} from "@/lib/import-automation.server";
import { commitIdempotencyKey, type CommitEvaluableRow } from "@/lib/commit-gate";
import { CLASSIFIER_VERSION, type RowClassification, type RowReview } from "@/lib/row-review";

const BATCH = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const cleanClassification: RowClassification = {
  classification: "auto_include",
  classification_reasons: ["clean_eligible"],
  duplicate_status: "checked_no_match",
  classified_at: "2026-08-30T00:00:00.000Z",
  classifier_version: CLASSIFIER_VERSION,
};
const includeReview: RowReview = { decision: "include", exclusion_reason: null, source: "auto" };

// --- minimal fake Supabase client -------------------------------------------

type Table = Record<string, unknown>;

type Db = Record<string, Table[]>;

function fakeClient(db: Db) {
  const calls: string[] = [];
  let seq = 0;
  const client = {
    db,
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const rows = () => (db[table] ??= []);
      const match = (row: Table) =>
        Object.entries(filters).every(([key, value]) => row[key] === value);
      let countMode = false;
      let pendingUpdate: Table | null = null;
      let pendingDelete = false;
      const inserted: Table[] = [];

      const apply = () => {
        if (pendingUpdate) {
          for (const row of rows().filter(match)) Object.assign(row, pendingUpdate);
          pendingUpdate = null;
        }
        if (pendingDelete) {
          db[table] = rows().filter((row) => !match(row));
          pendingDelete = false;
        }
      };

      const builder: Record<string, unknown> = {
        select: (_columns?: unknown, options?: { count?: string; head?: boolean }) => {
          if (options?.count) countMode = true;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        insert: (payload: Table | Table[]) => {
          calls.push(`insert:${table}`);
          for (const item of Array.isArray(payload) ? payload : [payload]) {
            const record = { id: (item["id"] as string) ?? `${table}-${++seq}`, ...item };
            rows().push(record);
            inserted.push(record);
          }
          return builder;
        },
        update: (payload: Table) => {
          calls.push(`update:${table}`);
          pendingUpdate = payload;
          return builder;
        },
        delete: () => {
          calls.push(`delete:${table}`);
          pendingDelete = true;
          return builder;
        },
        maybeSingle: async () => {
          apply();
          return { data: rows().find(match) ?? null, error: null };
        },
        single: async () => {
          apply();
          if (inserted.length > 0) return { data: inserted[0], error: null };
          return { data: rows().find(match) ?? null, error: null };
        },
      };
      (builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) => {
        apply();
        const matched = rows().filter(match);
        return Promise.resolve(
          countMode
            ? { count: matched.length, data: null, error: null }
            : { data: matched, error: null },
        ).then(resolve);
      };
      return builder;
    },
  };
  return client as unknown as Parameters<typeof loadAutomationState>[0] & {
    db: Db;
    calls: string[];
  };
}

function stagedRow(rowNumber: number, overrides: Table = {}): Table {
  return {
    id: `row-${rowNumber}`,
    batch_id: BATCH,
    business_id: TENANT,
    row_number: rowNumber,
    normalized_payload: {
      name: `Lead ${rowNumber}`,
      mobile_number: `+6141234567${rowNumber}`,
      email: `lead${rowNumber}@example.com`,
      email_normalised: `lead${rowNumber}@example.com`,
      review: includeReview,
      ...cleanClassification,
    },
    raw_row: { Name: `Lead ${rowNumber}` },
    validation_errors: [],
    dedupe_match_lead_id: null,
    resulting_lead_id: null,
    ...overrides,
  };
}

function baseDb(rowCount = 1, extra: Table[] = []): Db {
  return {
    businesses: [{ id: TENANT }],
    import_batches: [{ id: BATCH, business_id: TENANT, status: "previewed" }],
    lead_import_rows: [
      ...Array.from({ length: rowCount }, (_, index) => stagedRow(index + 1)),
      ...extra,
    ],
    leads: [],
    conversations: [],
    messages: [],
    jobs: [],
    notifications: [],
    automation_jobs: [],
    audit_events: [],
    import_automation_state: [],
  };
}

const noSideEffectTables = [
  "conversations",
  "messages",
  "jobs",
  "notifications",
  "automation_jobs",
];

function assertNoSideEffects(client: { db: Db; calls: string[] }) {
  for (const table of noSideEffectTables) {
    expect(client.db[table]).toEqual([]);
    expect(client.calls).not.toContain(`insert:${table}`);
    expect(client.calls).not.toContain(`update:${table}`);
  }
}

/** Walk a fresh tenant all the way to a verified exception-only state. */
async function promoteToExceptionOnly(client: ReturnType<typeof fakeClient>, canaryRow = 1) {
  await changeImportMode(client, TENANT, "canary_ready");
  const verification = await verifyCanaryImport(client, TENANT, BATCH, canaryRow);
  await changeImportMode(client, TENANT, "bounded_batch");
  return verification;
}

// --- rollout state -----------------------------------------------------------

describe("import rollout state", () => {
  it("defaults every tenant to preview_only with nothing verified", () => {
    expect(DEFAULT_IMPORT_MODE).toBe("preview_only");
    expect(DEFAULT_IMPORT_AUTOMATION_STATE.mode).toBe("preview_only");
    expect(DEFAULT_IMPORT_AUTOMATION_STATE.paused).toBe(false);
    expect(DEFAULT_IMPORT_AUTOMATION_STATE.canary_passed_at).toBeNull();
    expect(DEFAULT_IMPORT_AUTOMATION_STATE.bounded_batch_passed_at).toBeNull();
    expect(DEFAULT_IMPORT_AUTOMATION_STATE.exception_only_enabled_at).toBeNull();
  });

  it("creates the default row on first use for the caller's tenant only", async () => {
    const client = fakeClient(baseDb());
    const state = await loadAutomationState(client, TENANT);
    expect(state.mode).toBe("preview_only");
    expect(client.db["import_automation_state"]).toHaveLength(1);
    expect(client.db["import_automation_state"]![0]!["business_id"]).toBe(TENANT);
    const other = await loadAutomationState(client, OTHER);
    expect(other.mode).toBe("preview_only");
    expect(client.db["import_automation_state"]).toHaveLength(2);
  });

  it("falls back to preview_only for unknown persisted modes", () => {
    expect(readImportAutomationState({ mode: "yolo" }).mode).toBe("preview_only");
    expect(readImportAutomationState(null).mode).toBe("preview_only");
  });
});

describe("deliberate mode transitions", () => {
  const state = (overrides: Partial<ImportAutomationState> = {}): ImportAutomationState => ({
    ...DEFAULT_IMPORT_AUTOMATION_STATE,
    ...overrides,
  });

  it("never jumps straight from preview_only to exception_only", () => {
    const result = evaluateModeTransition(state(), "exception_only");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain("not_the_next_step");
  });

  it("allows preview_only → canary_ready", () => {
    expect(evaluateModeTransition(state(), "canary_ready").ok).toBe(true);
  });

  it("blocks bounded_batch until the canary and idempotency are verified", () => {
    const result = evaluateModeTransition(state({ mode: "canary_ready" }), "bounded_batch");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("canary_not_passed");
      expect(result.reasons).toContain("idempotency_not_verified");
    }
  });

  it("blocks exception_only until a bounded batch has passed", () => {
    const result = evaluateModeTransition(
      state({
        mode: "bounded_batch",
        canary_passed_at: "now",
        canary_lead_id: "lead-1",
        idempotency_verified_at: "now",
      }),
      "exception_only",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain("bounded_batch_not_passed");
  });

  it("allows exception_only once every gate has passed", () => {
    const result = evaluateModeTransition(
      state({
        mode: "bounded_batch",
        canary_passed_at: "now",
        canary_lead_id: "lead-1",
        idempotency_verified_at: "now",
        bounded_batch_passed_at: "now",
      }),
      "exception_only",
    );
    expect(result.ok).toBe(true);
  });

  it("can always be turned off, and resumes only at preview_only", () => {
    expect(evaluateModeTransition(state({ mode: "exception_only" }), "disabled").ok).toBe(true);
    expect(evaluateModeTransition(state({ mode: "disabled" }), "exception_only").ok).toBe(false);
    expect(evaluateModeTransition(state({ mode: "disabled" }), "preview_only").ok).toBe(true);
  });

  it("rejects unknown modes", () => {
    const result = evaluateModeTransition(state(), "turbo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain("unknown_mode");
  });
});

describe("import gates", () => {
  const verified: ImportAutomationState = {
    ...DEFAULT_IMPORT_AUTOMATION_STATE,
    mode: "exception_only",
    canary_passed_at: "now",
    canary_lead_id: "lead-1",
    idempotency_verified_at: "now",
    bounded_batch_passed_at: "now",
  };

  it("blocks the canary in preview_only and when disabled", () => {
    expect(evaluateCanaryGate(DEFAULT_IMPORT_AUTOMATION_STATE).reasons).toContain(
      "preview_only_mode",
    );
    expect(
      evaluateCanaryGate({ ...DEFAULT_IMPORT_AUTOMATION_STATE, mode: "disabled" }).reasons,
    ).toContain("mode_disabled");
  });

  it("blocks every import path for a paused tenant", () => {
    const paused = { ...verified, paused: true };
    expect(evaluateCanaryGate(paused).allowed).toBe(false);
    expect(evaluateBoundedBatchGate({ ...paused, mode: "bounded_batch" }, 1).reasons).toContain(
      "paused",
    );
    expect(evaluateExceptionOnlyGate(paused).reasons).toContain("paused");
  });

  it("caps the bounded batch at three rows", () => {
    expect(BOUNDED_BATCH_MAX_ROWS).toBe(3);
    const state = { ...verified, mode: "bounded_batch" as const };
    expect(evaluateBoundedBatchGate(state, 3).allowed).toBe(true);
    expect(evaluateBoundedBatchGate(state, 4).reasons).toContain("row_limit_exceeded");
    expect(evaluateBoundedBatchGate(state, 0).reasons).toContain("no_rows_selected");
    expect(
      limitBoundedBatch([
        { row_number: 5 },
        { row_number: 1 },
        { row_number: 9 },
        { row_number: 2 },
      ]),
    ).toEqual([{ row_number: 1 }, { row_number: 2 }, { row_number: 5 }]);
  });

  it("only allows automatic importing in exception_only mode", () => {
    expect(evaluateExceptionOnlyGate({ ...verified, mode: "bounded_batch" }).reasons).toContain(
      "mode_not_exception_only",
    );
    expect(evaluateExceptionOnlyGate(verified).allowed).toBe(true);
  });
});

// --- verified canary ---------------------------------------------------------

describe("canary verification", () => {
  it("cannot pass while the tenant is still in preview_only", async () => {
    const client = fakeClient(baseDb());
    const result = await verifyCanaryImport(client, TENANT, BATCH, 1);
    expect(result.status).toBe("blocked");
    expect(result.gate_reasons).toContain("preview_only_mode");
    expect(client.db["leads"]).toEqual([]);
    assertNoSideEffects(client);
  });

  it("requires a real controlled execution: creates one lead, verifies zero side effects and an idempotent re-run", async () => {
    const client = fakeClient(baseDb());
    await changeImportMode(client, TENANT, "canary_ready");
    const result = await verifyCanaryImport(client, TENANT, BATCH, 1);

    expect(result.status).toBe("passed");
    expect(result.leads_before).toBe(0);
    expect(result.leads_after).toBe(1);
    expect(client.db["leads"]).toHaveLength(1);
    expect(result.rerun_status).toBe("already_committed");
    for (const check of result.checks) expect(check.passed).toBe(true);
    expect(result.state.canary_passed_at).not.toBeNull();
    expect(result.state.idempotency_verified_at).not.toBeNull();
    assertNoSideEffects(client);
  });

  it("re-running the canary creates no duplicate lead", async () => {
    const client = fakeClient(baseDb());
    await changeImportMode(client, TENANT, "canary_ready");
    await verifyCanaryImport(client, TENANT, BATCH, 1);
    const again = await verifyCanaryImport(client, TENANT, BATCH, 1);
    expect(client.db["leads"]).toHaveLength(1);
    expect(again.status).toBe("blocked");
  });

  it("blocks the bounded batch until the canary actually passed", async () => {
    const client = fakeClient(baseDb(3));
    await changeImportMode(client, TENANT, "canary_ready");
    const change = await changeImportMode(client, TENANT, "bounded_batch");
    expect(change.ok).toBe(false);
    const result = await runBoundedBatch(client, TENANT, BATCH, [1, 2]);
    expect(result.status).toBe("blocked");
    expect(client.db["leads"]).toEqual([]);
  });
});

// --- bounded batch -----------------------------------------------------------

describe("bounded batch import", () => {
  it("imports at most three eligible rows and holds the rest", async () => {
    const client = fakeClient(baseDb(6));
    await promoteToExceptionOnly(client);
    const result = await runBoundedBatch(client, TENANT, BATCH, [2, 3, 4, 5]);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.reasons).toContain("row_limit_exceeded");

    const ok = await runBoundedBatch(client, TENANT, BATCH, [2, 3, 4]);
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") {
      expect(ok.summary.auto_imported).toBe(3);
      expect(ok.summary.mode).toBe("bounded_batch");
    }
    // one canary lead + three bounded rows
    expect(client.db["leads"]).toHaveLength(4);
    assertNoSideEffects(client);
  });

  it("is safe to re-run and creates no duplicates", async () => {
    const client = fakeClient(baseDb(4));
    await promoteToExceptionOnly(client);
    await runBoundedBatch(client, TENANT, BATCH, [2, 3]);
    const before = client.db["leads"]!.length;
    const again = await runBoundedBatch(client, TENANT, BATCH, [2, 3]);
    expect(client.db["leads"]).toHaveLength(before);
    if (again.status === "ok") {
      expect(again.summary.auto_imported).toBe(0);
      expect(again.summary.already_committed).toBeGreaterThanOrEqual(2);
    }
  });

  it("never touches pending, excluded, invalid-phone or duplicate rows", async () => {
    const db = baseDb(1, [
      stagedRow(2, {
        normalized_payload: {
          name: "Pending",
          mobile_number: "+61412345602",
          email: "p@example.com",
          review: { decision: "pending", exclusion_reason: null, source: "auto" },
          ...cleanClassification,
        },
      }),
      stagedRow(3, {
        normalized_payload: {
          name: "Excluded",
          mobile_number: "+61412345603",
          email: "e@example.com",
          review: { decision: "exclude", exclusion_reason: "bad_data", source: "manual" },
          ...cleanClassification,
        },
      }),
      stagedRow(4, {
        normalized_payload: {
          name: "Landline",
          mobile_number: "+61298765432",
          email: "l@example.com",
          review: includeReview,
          ...cleanClassification,
        },
      }),
      stagedRow(5, {
        dedupe_match_lead_id: "existing-lead",
        normalized_payload: {
          name: "Dup",
          mobile_number: "+61412345605",
          email: "d@example.com",
          review: includeReview,
          ...cleanClassification,
        },
      }),
    ]);
    const client = fakeClient(db);
    await promoteToExceptionOnly(client);
    const leadsAfterCanary = client.db["leads"]!.length;
    const result = await runBoundedBatch(client, TENANT, BATCH, [2, 3, 4]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.summary.auto_imported).toBe(0);
    expect(client.db["leads"]).toHaveLength(leadsAfterCanary);

    const dup = await runBoundedBatch(client, TENANT, BATCH, [5]);
    if (dup.status === "ok") expect(dup.summary.auto_imported).toBe(0);
    expect(client.db["leads"]).toHaveLength(leadsAfterCanary);
    assertNoSideEffects(client);
  });

  it("does not advance to exception_only on its own", async () => {
    const client = fakeClient(baseDb(4));
    await promoteToExceptionOnly(client);
    const result = await runBoundedBatch(client, TENANT, BATCH, [2]);
    if (result.status === "ok") {
      expect(result.state.mode).toBe("bounded_batch");
      expect(result.state.exception_only_enabled_at).toBeNull();
    }
  });
});

// --- exception-only mode -----------------------------------------------------

describe("exception-only mode", () => {
  async function ready(rowCount: number, extra: Table[] = []) {
    const client = fakeClient(baseDb(rowCount, extra));
    await promoteToExceptionOnly(client);
    await runBoundedBatch(client, TENANT, BATCH, [2]);
    const change = await changeImportMode(client, TENANT, "exception_only");
    expect(change.ok).toBe(true);
    return client;
  }

  it("imports clean rows automatically and holds every exception", async () => {
    const client = await ready(3, [
      stagedRow(9, {
        normalized_payload: {
          name: "Landline",
          mobile_number: "+61298765432",
          email: "l@example.com",
          review: includeReview,
          ...cleanClassification,
        },
      }),
      stagedRow(10, {
        normalized_payload: {
          name: "Unchecked",
          mobile_number: "+61412345610",
          email: "u@example.com",
          review: includeReview,
          ...cleanClassification,
          duplicate_status: "not_checked",
        },
      }),
      stagedRow(11, {
        normalized_payload: {
          name: "Lookup error",
          mobile_number: "+61412345611",
          email: "x@example.com",
          review: includeReview,
          ...cleanClassification,
          duplicate_status: "lookup_error",
        },
      }),
    ]);
    const before = client.db["leads"]!.length;
    const result = await runExceptionOnlyImport(client, TENANT, BATCH);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.summary.auto_imported).toBe(1); // only row 3 remained clean
      expect(result.summary.mode).toBe("exception_only");
      expect(result.summary.duplicate_lookup_unavailable).toBeGreaterThanOrEqual(2);
      expect(result.summary.conversations_created).toBe(0);
      expect(result.summary.sms_sent).toBe(0);
      expect(result.summary.emails_sent).toBe(0);
      expect(result.summary.owner_alerts).toBe(0);
      expect(result.summary.jobs_created).toBe(0);
      expect(result.summary.pipeline_changes).toBe(0);
      expect(result.summary.automation_runs).toBe(0);
      expect(result.summary.provider_calls).toBe(0);
    }
    expect(client.db["leads"]).toHaveLength(before + 1);
    assertNoSideEffects(client);
  });

  it("cannot auto-import while paused, and resumes only on an explicit action", async () => {
    const client = await ready(4);
    const paused = await setImportPaused(client, TENANT, true);
    expect(paused.paused).toBe(true);
    const before = client.db["leads"]!.length;
    const blocked = await runExceptionOnlyImport(client, TENANT, BATCH);
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") expect(blocked.reasons).toContain("paused");
    expect(client.db["leads"]).toHaveLength(before);

    const resumed = await setImportPaused(client, TENANT, false);
    expect(resumed.paused).toBe(false);
    const after = await runExceptionOnlyImport(client, TENANT, BATCH);
    expect(after.status).toBe("ok");
    assertNoSideEffects(client);
  });

  it("is tenant-scoped: another business cannot import this batch", async () => {
    const client = await ready(3);
    const result = await runExceptionOnlyImport(client, OTHER, BATCH);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.reasons).toContain("mode_not_exception_only");
  });

  it("leaves the legacy decision column untouched", async () => {
    const client = await ready(3);
    await runExceptionOnlyImport(client, TENANT, BATCH);
    for (const row of client.db["lead_import_rows"] ?? []) {
      expect(row["decision"]).toBeUndefined();
    }
  });

  it("records tenant-scoped audit events for every run", async () => {
    const client = await ready(3);
    await runExceptionOnlyImport(client, TENANT, BATCH);
    const events = client.db["audit_events"] ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event["business_id"]).toBe(TENANT);
    expect(events.some((event) => event["event_type"] === "crm_import_run_completed")).toBe(true);
    expect(events.some((event) => event["event_type"] === "crm_import_canary_verified")).toBe(true);
  });
});

// --- durable summary ---------------------------------------------------------

describe("post-import summary", () => {
  function row(overrides: Partial<CommitEvaluableRow> = {}): CommitEvaluableRow {
    return {
      row_number: 1,
      name: "Ava",
      mobile_number: "+61412345678",
      email: "ava@example.com",
      validation_errors: [],
      dedupe_match_lead_id: null,
      duplicate_of_row: null,
      review: includeReview,
      classification: cleanClassification,
      ...overrides,
    };
  }

  it("distinguishes auto-imported, manually imported, pending, excluded, blocked and failed", () => {
    const summary = buildImportSummary({
      mode: "exception_only",
      batchId: BATCH,
      ranAt: "2026-09-01T00:00:00.000Z",
      rows: [
        row({ row_number: 1 }),
        row({
          row_number: 2,
          review: { decision: "include", exclusion_reason: null, source: "manual" },
        }),
        row({
          row_number: 3,
          review: { decision: "pending", exclusion_reason: null, source: "auto" },
        }),
        row({
          row_number: 4,
          review: { decision: "exclude", exclusion_reason: "bad_data", source: "manual" },
        }),
        row({ row_number: 5, mobile_number: "+61298765432" }),
      ],
      results: [
        {
          row_number: 1,
          outcome: "auto_imported",
          lead_id: "lead-1",
          idempotency_key: commitIdempotencyKey(BATCH, 1),
          reasons: [],
          error: null,
        },
        {
          row_number: 2,
          outcome: "manually_imported",
          lead_id: "lead-2",
          idempotency_key: commitIdempotencyKey(BATCH, 2),
          reasons: [],
          error: null,
        },
      ],
    });

    expect(summary.total_uploaded).toBe(5);
    expect(summary.auto_imported).toBe(1);
    expect(summary.manually_imported).toBe(1);
    expect(summary.pending_review).toBe(1);
    expect(summary.excluded_rows).toBe(1);
    expect(summary.invalid_phones).toBe(1);
    expect(summary.failed_rows).toBe(0);
    expect(summary.conversations_created).toBe(0);
    expect(summary.sms_sent).toBe(0);
    expect(summary.emails_sent).toBe(0);
    expect(summary.owner_alerts).toBe(0);
    expect(summary.jobs_created).toBe(0);
    expect(summary.pipeline_changes).toBe(0);
    expect(summary.automation_runs).toBe(0);
    expect(summary.provider_calls).toBe(0);
  });

  it("counts reconciliation-required rows without retrying them", () => {
    const summary = buildImportSummary({
      mode: "bounded_batch",
      batchId: BATCH,
      ranAt: "2026-09-01T00:00:00.000Z",
      rows: [row()],
      results: [
        {
          row_number: 1,
          outcome: "reconciliation_required",
          lead_id: "lead-1",
          idempotency_key: commitIdempotencyKey(BATCH, 1),
          reasons: [],
          error: "linkage failed",
        },
      ],
    });
    expect(summary.reconciliation_required_rows).toBe(1);
    expect(summary.auto_imported).toBe(0);
  });
});
