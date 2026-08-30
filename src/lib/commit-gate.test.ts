import { describe, expect, it } from "vitest";
import {
  CANARY_LABEL,
  COMMIT_SIMULATION_LABEL,
  buildCommitSimulation,
  commitIdempotencyKey,
  evaluateCommitEligibility,
  readCommitState,
  rowCommitLabel,
  type CommitEvaluableRow,
} from "@/lib/commit-gate";
import { CANARY_BLOCKED_DETAIL, commitCanaryRow, revalidateCandidate, simulateCommit } from "@/lib/commit-gate.server";
import { CLASSIFIER_VERSION, type RowClassification, type RowReview } from "@/lib/row-review";

const BATCH = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";

const cleanClassification: RowClassification = {
  classification: "auto_include",
  classification_reasons: ["clean_eligible"],
  duplicate_status: "checked_no_match",
  classified_at: "2026-08-30T00:00:00.000Z",
  classifier_version: CLASSIFIER_VERSION,
};

const includeReview: RowReview = { decision: "include", exclusion_reason: null, source: "auto" };

function row(overrides: Partial<CommitEvaluableRow> = {}): CommitEvaluableRow {
  return {
    row_number: 1,
    name: "Ava Chen",
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

// --- fake tenant-scoped Supabase client -------------------------------------
// Records every mutating call so tests can assert the gate is read-only.

type FakeRow = {
  row_number: number;
  normalized_payload: Record<string, unknown>;
  validation_errors: unknown[];
  dedupe_match_lead_id: string | null;
  resulting_lead_id: string | null;
};

type FakeDb = {
  batches: { id: string; business_id: string; status: string }[];
  rows: (FakeRow & { batch_id: string; business_id: string })[];
  leads: { id: string; business_id: string; mobile_number: string | null; email: string | null; email_normalised: string | null; external_id: string | null }[];
  leadsError?: boolean;
};

function fakeClient(db: FakeDb) {
  const writes: string[] = [];
  const client = {
    writes,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        insert: () => {
          writes.push(`insert:${table}`);
          return builder;
        },
        update: () => {
          writes.push(`update:${table}`);
          return builder;
        },
        delete: () => {
          writes.push(`delete:${table}`);
          return builder;
        },
        maybeSingle: async () => {
          if (table === "import_batches") {
            const found = db.batches.find(
              (b) => b.id === filters["id"] && b.business_id === filters["business_id"],
            );
            return { data: found ?? null, error: null };
          }
          if (table === "leads") {
            const found = db.leads.find(
              (lead) =>
                lead.business_id === filters["business_id"] &&
                lead.external_id === filters["external_id"],
            );
            return { data: found ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then: undefined,
      };
      // The server code awaits the builder directly for list selects.
      (builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) => {
        if (table === "lead_import_rows") {
          const rows = db.rows
            .filter((r) => r.batch_id === filters["batch_id"] && r.business_id === filters["business_id"])
            .sort((a, b) => a.row_number - b.row_number);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        if (table === "leads") {
          if (db.leadsError) return Promise.resolve({ data: null, error: { message: "down" } }).then(resolve);
          const rows = db.leads.filter((lead) => lead.business_id === filters["business_id"]);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    },
  };
  return client as unknown as Parameters<typeof simulateCommit>[0] & { writes: string[] };
}

function stagedRow(overrides: Partial<FakeRow> = {}) {
  return {
    batch_id: BATCH,
    business_id: TENANT,
    row_number: 1,
    normalized_payload: {
      name: "Ava Chen",
      mobile_number: "+61412345678",
      email: "ava@example.com",
      review: includeReview,
      ...cleanClassification,
    } as Record<string, unknown>,
    validation_errors: [],
    dedupe_match_lead_id: null,
    resulting_lead_id: null,
    ...overrides,
  };
}

function baseDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    batches: [{ id: BATCH, business_id: TENANT, status: "previewed" }],
    rows: [stagedRow()],
    leads: [],
    ...overrides,
  };
}

describe("commit idempotency key", () => {
  it("is deterministic for the same source row", () => {
    expect(commitIdempotencyKey(BATCH, 7)).toBe(commitIdempotencyKey(BATCH, 7));
    expect(commitIdempotencyKey(BATCH, 7)).toBe(`crm-import:${BATCH}:row:7`);
  });

  it("differs per row and per batch", () => {
    expect(commitIdempotencyKey(BATCH, 7)).not.toBe(commitIdempotencyKey(BATCH, 8));
    expect(commitIdempotencyKey(BATCH, 7)).not.toBe(commitIdempotencyKey(TENANT, 7));
  });

  it("rejects an unusable row identity", () => {
    expect(() => commitIdempotencyKey(BATCH, 0)).toThrow();
    expect(() => commitIdempotencyKey("", 1)).toThrow();
  });
});

describe("commit candidate calculation", () => {
  it("accepts an included, clean, no-match row", () => {
    const result = evaluateCommitEligibility(BATCH, row());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.idempotency_key).toBe(commitIdempotencyKey(BATCH, 1));
  });

  it("excludes pending rows", () => {
    const result = evaluateCommitEligibility(BATCH, {
      ...row(),
      review: { decision: "pending", exclusion_reason: null, source: "auto" },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("pending");
  });

  it("excludes manually excluded rows", () => {
    const result = evaluateCommitEligibility(BATCH, {
      ...row(),
      review: { decision: "exclude", exclusion_reason: "not_mobile", source: "manual" },
    });
    expect(result.reasons).toContain("excluded");
  });

  it("excludes invalid and non-mobile phones", () => {
    expect(evaluateCommitEligibility(BATCH, row({ mobile_number: null })).reasons).toContain(
      "invalid_phone",
    );
    expect(
      evaluateCommitEligibility(BATCH, row({ mobile_number: "+61298765432" })).reasons,
    ).toContain("invalid_phone");
  });

  it("excludes rows with unresolved validation issues", () => {
    const result = evaluateCommitEligibility(
      BATCH,
      row({ validation_errors: [{ code: "invalid_email", field: "email" }] }),
    );
    expect(result.reasons).toContain("validation_issues");
  });

  it("excludes potential duplicates, unchecked lookups and lookup errors", () => {
    expect(
      evaluateCommitEligibility(
        BATCH,
        row({
          classification: { ...cleanClassification, duplicate_status: "potential_duplicate" },
        }),
      ).reasons,
    ).toContain("potential_duplicate");
    expect(
      evaluateCommitEligibility(
        BATCH,
        row({ classification: { ...cleanClassification, duplicate_status: "not_checked" } }),
      ).reasons,
    ).toContain("duplicate_not_checked");
    expect(
      evaluateCommitEligibility(
        BATCH,
        row({ classification: { ...cleanClassification, duplicate_status: "lookup_error" } }),
      ).reasons,
    ).toContain("duplicate_lookup_error");
    expect(
      evaluateCommitEligibility(BATCH, row({ dedupe_match_lead_id: "lead-1" })).reasons,
    ).toContain("potential_duplicate");
  });

  it("excludes rows that still need manual review", () => {
    const result = evaluateCommitEligibility(
      BATCH,
      row({
        classification: { ...cleanClassification, classification_reasons: ["missing_name"] },
      }),
    );
    expect(result.reasons).toContain("manual_review_required");
  });

  it("excludes already committed rows and previous failures", () => {
    expect(
      evaluateCommitEligibility(
        BATCH,
        row({ commit: { ...readCommitState(null), status: "committed", lead_id: "lead-9" } }),
      ).reasons,
    ).toContain("already_committed");
    expect(
      evaluateCommitEligibility(
        BATCH,
        row({ commit: { ...readCommitState(null), status: "failed", error: "boom" } }),
      ).reasons,
    ).toContain("previous_attempt_failed");
  });

  it("does not mutate the row it evaluates", () => {
    const input = row();
    const snapshot = JSON.stringify(input);
    evaluateCommitEligibility(BATCH, input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("commit simulation", () => {
  const rows: CommitEvaluableRow[] = [
    row({ row_number: 1 }),
    row({
      row_number: 2,
      review: { decision: "pending", exclusion_reason: null, source: "auto" },
      classification: { ...cleanClassification, classification_reasons: ["invalid_phone"] },
      mobile_number: null,
    }),
    row({
      row_number: 3,
      review: { decision: "exclude", exclusion_reason: "not_mobile", source: "manual" },
    }),
    row({
      row_number: 4,
      commit: { ...readCommitState(null), status: "committed", lead_id: "lead-4" },
    }),
    row({
      row_number: 5,
      review: { decision: "include", exclusion_reason: null, source: "manual" },
    }),
  ];

  it("reports candidates, blockers and identity for every candidate", () => {
    const simulation = buildCommitSimulation(BATCH, rows);
    expect(simulation.label).toBe(COMMIT_SIMULATION_LABEL);
    expect(simulation.total_rows).toBe(5);
    expect(simulation.total_candidates).toBe(2);
    expect(simulation.would_create).toBe(2);
    expect(simulation.skipped_pending).toBe(1);
    expect(simulation.skipped_excluded).toBe(1);
    expect(simulation.already_committed).toBe(1);
    expect(simulation.candidates.map((c) => c.row_number)).toEqual([1, 5]);
    expect(simulation.candidates.map((c) => c.source)).toEqual(["auto", "manual"]);
    for (const candidate of simulation.candidates) {
      expect(candidate.idempotency_key).toBe(commitIdempotencyKey(BATCH, candidate.row_number));
      expect(candidate.mobile_number).toBe("+61412345678");
      expect(candidate.email).toBe("ava@example.com");
    }
  });

  it("labels rows without implying include means imported", () => {
    expect(rowCommitLabel(rows[0]!, BATCH)).toBe("Auto-included candidate");
    expect(rowCommitLabel(rows[4]!, BATCH)).toBe("Manually included candidate");
    expect(rowCommitLabel(rows[1]!, BATCH)).toBe("Pending");
    expect(rowCommitLabel(rows[2]!, BATCH)).toBe("Excluded");
    expect(rowCommitLabel(rows[3]!, BATCH)).toBe("Canary imported");
  });

  it("runs server-side without writing or calling a provider", async () => {
    const client = fakeClient(baseDb());
    const result = await simulateCommit(client, TENANT, BATCH);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.simulation.total_candidates).toBe(1);
      expect(result.simulation.candidates[0]!.idempotency_key).toBe(commitIdempotencyKey(BATCH, 1));
    }
    expect(client.writes).toEqual([]);
  });

  it("is tenant-scoped", async () => {
    const client = fakeClient(baseDb());
    expect((await simulateCommit(client, OTHER_TENANT, BATCH)).status).toBe("unavailable");
    expect(client.writes).toEqual([]);
  });

  it("refuses batches that are no longer uncommitted staging", async () => {
    const client = fakeClient(
      baseDb({ batches: [{ id: BATCH, business_id: TENANT, status: "committed" }] }),
    );
    expect((await simulateCommit(client, TENANT, BATCH)).status).toBe("batch_already_committed");
    expect(client.writes).toEqual([]);
  });
});

describe("final pre-commit revalidation", () => {
  it("passes for a still-eligible candidate and stays read-only", async () => {
    const client = fakeClient(baseDb());
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe(commitIdempotencyKey(BATCH, 1));
    expect(client.writes).toEqual([]);
  });

  it("blocks a foreign tenant", async () => {
    const client = fakeClient(baseDb());
    const result = await revalidateCandidate(client, OTHER_TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome.status === "blocked") {
      expect(result.outcome.reasons).toContain("foreign_tenant");
    }
  });

  it("blocks when the row state changed to pending", async () => {
    const staged = stagedRow();
    staged.normalized_payload = {
      ...staged.normalized_payload,
      review: { decision: "pending", exclusion_reason: null, source: "manual" },
    };
    const client = fakeClient(baseDb({ rows: [staged] }));
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome.status === "blocked") {
      expect(result.outcome.reasons).toContain("pending");
    }
  });

  it("blocks when a live duplicate appears during the recheck", async () => {
    const client = fakeClient(
      baseDb({
        leads: [
          {
            id: "live-lead-1",
            business_id: TENANT,
            mobile_number: "+61412345678",
            email: null,
            email_normalised: null,
            external_id: null,
          },
        ],
      }),
    );
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome.status).toBe("potential_duplicate");
      if (result.outcome.status === "potential_duplicate") {
        expect(result.outcome.existing_lead_id).toBe("live-lead-1");
      }
    }
    expect(client.writes).toEqual([]);
  });

  it("fails closed when the duplicate lookup errors", async () => {
    const client = fakeClient(baseDb({ leadsError: true }));
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome.status === "blocked") {
      expect(result.outcome.reasons).toContain("duplicate_lookup_error");
    }
  });

  it("returns already_committed when the idempotency key is already live", async () => {
    const client = fakeClient(
      baseDb({
        leads: [
          {
            id: "live-lead-2",
            business_id: TENANT,
            mobile_number: null,
            email: null,
            email_normalised: null,
            external_id: commitIdempotencyKey(BATCH, 1),
          },
        ],
      }),
    );
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe("already_committed");
  });

  it("returns already_committed when the preview row already has a live lead id", async () => {
    const client = fakeClient(baseDb({ rows: [stagedRow({ resulting_lead_id: "live-lead-3" })] }));
    const result = await revalidateCandidate(client, TENANT, BATCH, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome.status === "already_committed") {
      expect(result.outcome.lead_id).toBe("live-lead-3");
    }
    expect(client.writes).toEqual([]);
  });

  it("blocks a missing row", async () => {
    const client = fakeClient(baseDb());
    const result = await revalidateCandidate(client, TENANT, BATCH, 99);
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome.status === "blocked") {
      expect(result.outcome.reasons).toContain("row_not_found");
    }
  });
});

describe("canary import gate", () => {
  it("uses a deliberate one-row label", () => {
    expect(CANARY_LABEL).toBe("IMPORT ONE CANARY LEAD");
  });

  it("fails closed because the existing lead creation path has side effects", async () => {
    const client = fakeClient(baseDb());
    const outcome = await commitCanaryRow(client, TENANT, BATCH, 1);
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.reasons).toContain("unsafe_lead_creation_path");
      expect(outcome.detail).toBe(CANARY_BLOCKED_DETAIL);
    }
    // No lead, conversation, message, job, automation or pipeline write occurred.
    expect(client.writes).toEqual([]);
  });

  it("is safe to run twice: still zero writes", async () => {
    const client = fakeClient(baseDb());
    await commitCanaryRow(client, TENANT, BATCH, 1);
    await commitCanaryRow(client, TENANT, BATCH, 1);
    expect(client.writes).toEqual([]);
  });

  it("cannot be run for an ineligible row or a foreign tenant", async () => {
    const client = fakeClient(baseDb());
    const foreign = await commitCanaryRow(client, OTHER_TENANT, BATCH, 1);
    expect(foreign.status).toBe("blocked");
    const excluded = stagedRow();
    excluded.normalized_payload = {
      ...excluded.normalized_payload,
      review: { decision: "exclude", exclusion_reason: "not_mobile", source: "manual" },
    };
    const client2 = fakeClient(baseDb({ rows: [excluded] }));
    const outcome = await commitCanaryRow(client2, TENANT, BATCH, 1);
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.reasons).toContain("excluded");
    expect(client2.writes).toEqual([]);
  });

  it("preserves manual decisions, exclusion reasons and the legacy decision column", async () => {
    const staged = stagedRow();
    const snapshot = JSON.stringify(staged);
    const client = fakeClient(baseDb({ rows: [staged] }));
    await simulateCommit(client, TENANT, BATCH);
    await commitCanaryRow(client, TENANT, BATCH, 1);
    expect(JSON.stringify(staged)).toBe(snapshot);
    expect(client.writes).toEqual([]);
  });
});
