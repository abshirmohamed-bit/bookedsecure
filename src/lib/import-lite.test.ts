import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ADVANCED_VIEW_LABEL,
  DEFAULT_IMPORT_VIEW,
  EXCEPTION_ANCHOR_ID,
  SYNC_ACTION_LABEL,
  TECHNICAL_TERMS,
  advancedHighlight,
  buildLiteSummary,
  chooseSyncPath,
  liteSummaryLines,
  planLiteSync,
} from "@/lib/import-lite";
import {
  BOUNDED_BATCH_MAX_ROWS,
  DEFAULT_IMPORT_AUTOMATION_STATE,
  type ImportAutomationState,
} from "@/lib/import-automation";
import { commitIdempotencyKey, type CommitEvaluableRow } from "@/lib/commit-gate";
import { DEFAULT_CLASSIFICATION, DEFAULT_REVIEW } from "@/lib/row-review";

const BATCH = "11111111-1111-4111-8111-111111111111";

function cleanRow(rowNumber: number, overrides: Partial<CommitEvaluableRow> = {}): CommitEvaluableRow {
  return {
    row_number: rowNumber,
    name: `Clean ${rowNumber}`,
    mobile_number: `+6141234${String(1000 + rowNumber)}`,
    email: `clean${rowNumber}@example.com`,
    validation_errors: [],
    dedupe_match_lead_id: null,
    duplicate_of_row: null,
    review: { ...DEFAULT_REVIEW, decision: "include", source: "auto" },
    classification: {
      ...DEFAULT_CLASSIFICATION,
      classification: "auto_include",
      duplicate_status: "checked_no_match",
      classification_reasons: [],
    },
    commit: {
      status: "not_committed",
      idempotency_key: commitIdempotencyKey(BATCH, rowNumber),
      lead_id: null,
      committed_at: null,
      attempted_at: null,
      error: null,
      reconciliation_required: false,
    },
    ...overrides,
  } as CommitEvaluableRow;
}

function heldPhoneRow(rowNumber: number): CommitEvaluableRow {
  return cleanRow(rowNumber, {
    mobile_number: null,
    validation_errors: [{ code: "invalid_phone" }],
    review: { ...DEFAULT_REVIEW },
    classification: {
      ...DEFAULT_CLASSIFICATION,
      classification: "manual_review",
      duplicate_status: "checked_no_match",
      classification_reasons: ["invalid_phone"],
    },
  });
}

function duplicateRow(rowNumber: number): CommitEvaluableRow {
  return cleanRow(rowNumber, {
    dedupe_match_lead_id: "lead-existing",
    review: { ...DEFAULT_REVIEW },
    classification: {
      ...DEFAULT_CLASSIFICATION,
      classification: "manual_review",
      duplicate_status: "potential_duplicate",
      classification_reasons: ["potential_duplicate"],
    },
  });
}

const enabled = (patch: Partial<ImportAutomationState> = {}): ImportAutomationState => ({
  ...DEFAULT_IMPORT_AUTOMATION_STATE,
  mode: "exception_only",
  canary_passed_at: "2026-01-01T00:00:00.000Z",
  canary_lead_id: "lead-canary",
  idempotency_verified_at: "2026-01-01T00:00:00.000Z",
  bounded_batch_passed_at: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("lite mode defaults", () => {
  it("selects lite mode by default for every user", () => {
    expect(DEFAULT_IMPORT_VIEW).toBe("lite");
  });

  it("defaults the import route view state to lite", async () => {
    const source = await readFile("src/routes/import.tsx", "utf8");
    expect(source).toContain("useState<ImportView>(DEFAULT_IMPORT_VIEW)");
    // The advanced tree is only rendered after the lite branch returns.
    expect(source).toContain('if (view === "lite")');
  });

  it("does not render technical advanced controls in the lite panel", async () => {
    const source = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    for (const forbidden of [
      "PreviewTable",
      "DecisionControl",
      "StagedRowEditor",
      "RepairPanel",
      "CommitGatePanel",
      "RolloutPanel",
      "SummaryPanel",
      "simulateCrmCommit",
      "verifyImportCanary",
      "setCrmImportRowDecision",
      "<table",
      'type="checkbox"',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("keeps technical vocabulary out of lite-mode copy", async () => {
    const source = (await readFile("src/components/LiteImportPanel.tsx", "utf8")).toLowerCase();
    const strings = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    for (const term of TECHNICAL_TERMS) {
      expect(strings).not.toContain(`"${term}`);
      expect(strings).not.toContain(`>${term}`);
    }
  });

  it("exposes advanced view through a labelled, keyboard-reachable button", async () => {
    const source = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    expect(source).toContain("ADVANCED_VIEW_LABEL");
    expect(source).toContain("onOpenAdvanced");
    expect(source).toContain("aria-label={highlight.ariaLabel}");
    expect(ADVANCED_VIEW_LABEL).toBe("Advanced View");
  });
});

describe("lite summary shares the advanced validation engine", () => {
  const rows = [
    cleanRow(1),
    cleanRow(2),
    cleanRow(3),
    cleanRow(4),
    heldPhoneRow(5),
    duplicateRow(6),
  ];

  it("counts verified, clean and held contacts", () => {
    const summary = buildLiteSummary(BATCH, rows);
    expect(summary.total).toBe(6);
    expect(summary.clean).toBe(4);
    expect(summary.held).toBe(2);
    expect(summary.reviewable).toBe(2);
    expect(summary.eligible_rows).toEqual([1, 2, 3, 4]);
    expect(summary.hold_reason_counts.needs_phone_fix).toBe(1);
    expect(summary.hold_reason_counts.possible_duplicate).toBe(1);
  });

  it("phrases the summary in business language", () => {
    const lines = liteSummaryLines(buildLiteSummary(BATCH, rows));
    expect(lines[0]).toBe("We verified 6 contacts.");
    expect(lines[1]).toBe("4 are ready to save.");
    expect(lines[2]).toBe("2 were held safely because they need review.");
  });

  it("never offers a held row as eligible for syncing", () => {
    const summary = buildLiteSummary(BATCH, rows);
    expect(summary.eligible_rows).not.toContain(5);
    expect(summary.eligible_rows).not.toContain(6);
    const plan = planLiteSync(summary, enabled());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.rowNumbers).toEqual([1, 2, 3, 4]);
      expect(plan.rowNumbers).not.toContain(5);
    }
  });

  it("reflects an advanced-view row edit in the lite totals immediately", () => {
    const before = buildLiteSummary(BATCH, rows);
    // The owner repairs the phone in advanced view; the same shared rows are
    // re-evaluated, so the lite summary moves without any lite-specific logic.
    const repaired = rows.map((row) => (row.row_number === 5 ? cleanRow(5) : row));
    const after = buildLiteSummary(BATCH, repaired);
    expect(after.clean).toBe(before.clean + 1);
    expect(after.held).toBe(before.held - 1);
    expect(after.eligible_rows).toContain(5);
  });

  it("counts already-saved contacts separately from held ones", () => {
    const committed = cleanRow(7, {
      commit: {
        status: "committed",
        idempotency_key: commitIdempotencyKey(BATCH, 7),
        lead_id: "lead-7",
        committed_at: "2026-01-02T00:00:00.000Z",
        attempted_at: null,
        error: null,
        reconciliation_required: false,
      },
    } as Partial<CommitEvaluableRow>);
    const summary = buildLiteSummary(BATCH, [...rows, committed]);
    expect(summary.already_saved).toBe(1);
    expect(summary.held).toBe(2);
    expect(summary.eligible_rows).not.toContain(7);
  });
});

describe("advanced view highlight", () => {
  it("only highlights while reviewable exceptions exist", () => {
    expect(advancedHighlight({ held: 0 }).highlight).toBe(false);
    expect(advancedHighlight({ held: 0 }).annotation).toBeNull();
    expect(advancedHighlight({ held: 3 }).highlight).toBe(true);
  });

  it("annotates the correct held count in business language", () => {
    expect(advancedHighlight({ held: 12 }).annotation).toBe(
      "12 contacts need review in Advanced View",
    );
    expect(advancedHighlight({ held: 1 }).annotation).toBe(
      "1 contact needs review in Advanced View",
    );
  });

  it("never uses a destructive treatment for safely held contacts", () => {
    const highlight = advancedHighlight({ held: 4 });
    expect(highlight.className).not.toContain("destructive");
    expect(highlight.className).not.toContain("red");
    expect(highlight.annotation).not.toMatch(/error|failed/i);
  });

  it("simplifies the glow when reduced motion is preferred", () => {
    const motion = advancedHighlight({ held: 4, reducedMotion: false });
    const reduced = advancedHighlight({ held: 4, reducedMotion: true });
    expect(motion.animated).toBe(true);
    expect(motion.className).toContain("animate-pulse");
    expect(reduced.animated).toBe(false);
    expect(reduced.className).not.toContain("animate-pulse");
    expect(reduced.highlight).toBe(true);
  });

  it("labels the button for screen readers with the held count", () => {
    expect(advancedHighlight({ held: 2 }).ariaLabel).toBe(
      "Advanced View — 2 contacts need review",
    );
  });

  it("respects the reduced-motion media query and CSS fallback", async () => {
    const component = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    expect(component).toContain("prefers-reduced-motion: reduce");
    expect(component).toContain("motion-reduce:animate-none");
  });

  it("routes the annotation and button into the exception review area", async () => {
    const component = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    expect(component).toContain("onOpenAdvanced({ focusExceptions: true })");
    const route = await readFile("src/routes/import.tsx", "utf8");
    expect(route).toContain("focusExceptions={focusExceptions}");
    expect(route).toContain("EXCEPTION_ANCHOR_ID");
    expect(route).toContain('focusExceptions ? "needs_review" : "all"');
    expect(EXCEPTION_ANCHOR_ID).toBe("import-exceptions");
  });
});

describe("lite sync uses the existing controlled execution paths", () => {
  it("chooses the bounded path for small candidate sets", () => {
    expect(chooseSyncPath(1)).toBe("bounded");
    expect(chooseSyncPath(BOUNDED_BATCH_MAX_ROWS)).toBe("bounded");
    expect(chooseSyncPath(BOUNDED_BATCH_MAX_ROWS + 1)).toBe("exception_only");
  });

  it("blocks syncing when nothing is eligible", () => {
    const summary = buildLiteSummary(BATCH, [heldPhoneRow(1)]);
    expect(planLiteSync(summary, enabled())).toEqual({ ok: false, reason: "nothing_to_sync" });
  });

  it("respects the tenant pause switch and rollout mode", () => {
    const summary = buildLiteSummary(BATCH, [cleanRow(1)]);
    expect(planLiteSync(summary, enabled({ paused: true }))).toEqual({
      ok: false,
      reason: "paused",
    });
    expect(planLiteSync(summary, DEFAULT_IMPORT_AUTOMATION_STATE)).toEqual({
      ok: false,
      reason: "not_enabled",
    });
    expect(planLiteSync(summary, enabled({ mode: "disabled" }))).toEqual({
      ok: false,
      reason: "not_enabled",
    });
    expect(planLiteSync(summary, null)).toEqual({ ok: false, reason: "not_enabled" });
  });

  it("calls only the existing owner-gated server import functions", async () => {
    const component = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    expect(component).toContain("runImportBoundedBatch");
    expect(component).toContain("runImportExceptionOnly");
    // No bespoke import path, and no direct database or provider access.
    for (const forbidden of [
      "importStagedRowAsLead",
      "commitCanaryRow",
      "captureLead",
      "supabase",
      "sendSms",
      "fetch(",
    ]) {
      expect(component).not.toContain(forbidden);
    }
    // Both server functions remain owner-gated on the server.
    const functions = await readFile("src/lib/import-automation.functions.ts", "utf8");
    expect(functions).toContain("requireSupabaseAuth");
    expect(functions.match(/requireOwner|owner\(context as never\)/g)?.length).toBeGreaterThan(0);
    expect(SYNC_ACTION_LABEL).toBe("Sync Eligible Contacts");
  });

  it("keeps the pure lite module free of IO and live-write vocabulary", async () => {
    const source = await readFile("src/lib/import-lite.ts", "utf8");
    for (const forbidden of [
      'from("leads")',
      'from("messages")',
      'from("conversations")',
      'from("jobs")',
      'from("automation_jobs")',
      "captureLead",
      "supabase",
      "telnyx",
      "sinch",
      "fetch(",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("performs no IO merely by summarising or planning either view", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const summary = buildLiteSummary(BATCH, [cleanRow(1), heldPhoneRow(2)]);
    planLiteSync(summary, enabled());
    advancedHighlight({ held: summary.held });
    liteSummaryLines(summary);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
