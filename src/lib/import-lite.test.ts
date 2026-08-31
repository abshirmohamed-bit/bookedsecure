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
  buildLiteSyncReport,
  chooseSyncPath,
  isLiteRetryable,
  liteSummaryLines,
  liteSyncHeadline,
  liteSyncOutcome,
  planLiteSync,
} from "@/lib/import-lite";
import {
  BOUNDED_BATCH_MAX_ROWS,
  DEFAULT_IMPORT_AUTOMATION_STATE,
  buildImportSummary,
  type ImportAutomationState,
  type RowResult,
} from "@/lib/import-automation";
import {
  commitIdempotencyKey,
  evaluateCommitEligibility,
  type CommitEvaluableRow,
} from "@/lib/commit-gate";
import { prepareRow } from "@/lib/csv-import";
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

// --- automated lite preparation ------------------------------------------------

describe("lite mode automates the existing safe preparation workflow", () => {
  it("automatically invokes the existing owner-gated deterministic repair pass", async () => {
    const component = await readFile("src/components/LiteImportPanel.tsx", "utf8");
    // The single approved preparation entry point, run for the owner instead of
    // requiring them to press a technical button in the advanced view.
    expect(component).toContain("repairCrmImportPhones");
    expect(component).toContain("prepare.mutate(batchId)");
    expect(component).toContain("useEffect");
    // No second phone-repair implementation anywhere in the lite path.
    expect(component).not.toContain("repairPhone");
    const lite = await readFile("src/lib/import-lite.ts", "utf8");
    expect(lite).not.toContain("repairPhone");
  });

  it("runs the repair pass through the owner-gated tenant-scoped server function", async () => {
    const functions = await readFile("src/lib/csv-import.functions.ts", "utf8");
    const block = functions.slice(functions.indexOf("export const repairCrmImportPhones"));
    expect(block).toContain("requireSupabaseAuth");
    expect(block).toContain("requireOwner(app)");
    expect(block).toContain("app.businessId");
  });

  it("keeps the preparation pass preview-only — it never touches live records", async () => {
    const server = await readFile("src/lib/csv-import.server.ts", "utf8");
    const pass = server.slice(
      server.indexOf("export async function repairPreviewBatch"),
      server.indexOf("export async function editStagedRow"),
    );
    expect(pass.length).toBeGreaterThan(0);
    for (const forbidden of [
      "captureLead",
      "sendSms",
      'from("leads")',
      'from("messages")',
      'from("conversations")',
      'from("jobs")',
      'from("notifications")',
      'from("automation_jobs")',
      "telnyx",
    ]) {
      expect(pass.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("repairs a nine-digit Australian mobile and only then makes it eligible", () => {
    const row = prepareRow(["Name", "Email", "Phone"], ["Nine", "nine@example.com", "424012949"], 1);
    expect(row.normalized_payload.mobile_number).toBe("+61424012949");
    expect(row.normalized_payload.source_metadata["phone_raw"]).toBe("424012949");
    expect(row.normalized_payload.phone_repair?.reason).toBeTruthy();

    const repaired = cleanRow(1, { mobile_number: row.normalized_payload.mobile_number });
    expect(buildLiteSummary(BATCH, [repaired]).eligible_rows).toEqual([1]);
  });

  it("cleans an extra trunk zero after the country code", () => {
    const row = prepareRow(
      ["Name", "Email", "Phone"],
      ["Trunk", "trunk@example.com", "+610404398423"],
      1,
    );
    expect(row.normalized_payload.mobile_number).toBe("+61404398423");
    expect(row.normalized_payload.phone_repair?.actions).toContain("removed_extra_trunk_zero");
  });

  it("is idempotent when preparation runs again on an already-repaired value", () => {
    const first = prepareRow(["Name", "Phone"], ["Nine", "424012949"], 1);
    const second = prepareRow(
      ["Name", "Phone"],
      ["Nine", first.normalized_payload.mobile_number ?? ""],
      1,
    );
    expect(second.normalized_payload.mobile_number).toBe(first.normalized_payload.mobile_number);
    const before = buildLiteSummary(BATCH, [cleanRow(1, { mobile_number: first.normalized_payload.mobile_number })]);
    const after = buildLiteSummary(BATCH, [cleanRow(1, { mobile_number: second.normalized_payload.mobile_number })]);
    expect(after).toEqual(before);
  });

  it("keeps an uncertain or unrepairable phone held for advanced review", () => {
    const uncertain = prepareRow(["Name", "Email", "Phone"], ["Sam", "sam@example.com", "0404"], 1);
    expect(uncertain.normalized_payload.mobile_number).toBeNull();
    const summary = buildLiteSummary(BATCH, [heldPhoneRow(1)]);
    expect(summary.eligible_rows).toEqual([]);
    expect(summary.held).toBe(1);
    expect(summary.hold_reason_counts.needs_phone_fix).toBe(1);
  });

  it("derives the lite candidate set from the identical shared eligibility engine", () => {
    const rows = [cleanRow(1), heldPhoneRow(2), duplicateRow(3), cleanRow(4)];
    const advanced = rows
      .filter((row) => evaluateCommitEligibility(BATCH, row).eligible)
      .map((row) => row.row_number);
    expect(buildLiteSummary(BATCH, rows).eligible_rows).toEqual(advanced);
    expect(advanced).toEqual([1, 4]);
  });

  it("never lets a blocked row be forced through the lite sync plan", () => {
    const rows = [heldPhoneRow(1), duplicateRow(2)];
    const summary = buildLiteSummary(BATCH, rows);
    expect(planLiteSync(summary, enabled())).toEqual({ ok: false, reason: "nothing_to_sync" });
  });

  it("moves a row into the lite candidate set only after an advanced edit fixes it", () => {
    const rows = [heldPhoneRow(1), cleanRow(2)];
    expect(buildLiteSummary(BATCH, rows).eligible_rows).toEqual([2]);
    // The same shared rows after an advanced-view repair + revalidation.
    const edited = rows.map((row) => (row.row_number === 1 ? cleanRow(1) : row));
    const after = buildLiteSummary(BATCH, edited);
    expect(after.eligible_rows).toEqual([1, 2]);
    expect(after.held).toBe(0);
    // Being edited does not commit anything: an explicit sync is still required.
    expect(planLiteSync(after, enabled()).ok).toBe(true);
    expect(after.already_saved).toBe(0);
  });
});

describe("lite sync reports every per-row outcome honestly", () => {
  const summaryFor = (results: RowResult[], rows: CommitEvaluableRow[]) =>
    buildImportSummary({
      mode: "exception_only",
      batchId: BATCH,
      ranAt: "2026-03-01T00:00:00.000Z",
      rows,
      results,
    });

  const result = (rowNumber: number, outcome: RowResult["outcome"]): RowResult => ({
    row_number: rowNumber,
    outcome,
    lead_id: outcome === "auto_imported" ? `lead-${rowNumber}` : null,
    idempotency_key: commitIdempotencyKey(BATCH, rowNumber),
    reasons: [],
    error: outcome === "failed" ? "insert failed" : null,
  });

  it("distinguishes saved, already saved, held and failed rows", () => {
    const rows = [cleanRow(1), cleanRow(2), cleanRow(3), heldPhoneRow(4)];
    const report = buildLiteSyncReport(
      summaryFor(
        [
          result(1, "auto_imported"),
          result(2, "already_committed"),
          result(3, "failed"),
          result(4, "blocked"),
        ],
        rows,
      ),
    );
    expect(report.saved).toBe(1);
    expect(report.already_saved).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.held).toBe(1);
    expect(report.rows.map((row) => row.outcome)).toEqual([
      "saved",
      "already_saved",
      "failed",
      "held",
    ]);
  });

  it("never hides a partial failure behind a generic success message", () => {
    const report = buildLiteSyncReport(
      summaryFor([result(1, "auto_imported"), result(2, "failed")], [cleanRow(1), cleanRow(2)]),
    );
    expect(report.partial_failure).toBe(true);
    const headline = liteSyncHeadline(report);
    expect(headline).toContain("1 contact saved");
    expect(headline).toContain("could not be saved");
  });

  it("keeps only failed rows retryable, and never a saved or held row", () => {
    const report = buildLiteSyncReport(
      summaryFor(
        [
          result(1, "auto_imported"),
          result(2, "failed"),
          result(3, "already_committed"),
          result(4, "reconciliation_required"),
        ],
        [cleanRow(1), cleanRow(2), cleanRow(3), heldPhoneRow(4)],
      ),
    );
    expect(report.retryable_rows).toEqual([2]);
    expect(isLiteRetryable(result(1, "auto_imported"))).toBe(false);
    expect(isLiteRetryable(result(4, "reconciliation_required"))).toBe(false);
    expect(liteSyncOutcome("reconciliation_required")).toBe("held");
  });

  it("retries only the still-eligible rows and never duplicates a saved row", () => {
    const committed = (rowNumber: number) =>
      cleanRow(rowNumber, {
        commit: {
          status: "committed",
          idempotency_key: commitIdempotencyKey(BATCH, rowNumber),
          lead_id: `lead-${rowNumber}`,
          committed_at: "2026-03-01T00:00:00.000Z",
          attempted_at: null,
          error: null,
          reconciliation_required: false,
        },
      } as Partial<CommitEvaluableRow>);

    // State after a partial run: row 1 saved, row 2 failed and still staged.
    const afterRun = [committed(1), cleanRow(2)];
    const retryPlan = planLiteSync(buildLiteSummary(BATCH, afterRun), enabled());
    expect(retryPlan.ok).toBe(true);
    if (retryPlan.ok) expect(retryPlan.rowNumbers).toEqual([2]);

    // A retry that still includes row 1 gets already_committed, never a duplicate.
    const retryReport = buildLiteSyncReport(
      summaryFor([result(1, "already_committed"), result(2, "auto_imported")], afterRun),
    );
    expect(retryReport.saved).toBe(1);
    expect(retryReport.already_saved).toBe(1);
    expect(retryReport.failed).toBe(0);
  });

  it("keeps the import-only invariants at zero for every reported run", () => {
    const summary = summaryFor([result(1, "auto_imported"), result(2, "failed")], [
      cleanRow(1),
      cleanRow(2),
    ]);
    expect(summary.sms_sent).toBe(0);
    expect(summary.emails_sent).toBe(0);
    expect(summary.conversations_created).toBe(0);
    expect(summary.jobs_created).toBe(0);
    expect(summary.owner_alerts).toBe(0);
    expect(summary.automation_runs).toBe(0);
    expect(summary.provider_calls).toBe(0);
    expect(summary.pipeline_changes).toBe(0);
  });

  it("revalidates every candidate immediately before insertion on both paths", async () => {
    const server = await readFile("src/lib/import-automation.server.ts", "utf8");
    const importOne = server.slice(
      server.indexOf("async function importOne("),
      server.indexOf("async function finishRun("),
    );
    // Revalidation happens first, and the write is the single approved path.
    expect(importOne.indexOf("revalidateCandidate")).toBeLessThan(
      importOne.indexOf("importStagedRowAsLead"),
    );
    expect(importOne).toContain("if (!revalidated.ok)");
    expect(server).toContain("runBoundedBatch");
    expect(server).toContain("runExceptionOnlyImport");
    // Ignore the module's own safety commentary; scan executable lines only.
    const code = server
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["capturelead", "sendsms", 'from("messages").insert', "telnyx"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("fails closed on rollout mode and pause for the automated lite path", () => {
    const summary = buildLiteSummary(BATCH, [cleanRow(1)]);
    expect(planLiteSync(summary, enabled({ mode: "preview_only" })).ok).toBe(false);
    expect(planLiteSync(summary, enabled({ paused: true })).ok).toBe(false);
    expect(planLiteSync(summary, enabled({ mode: "canary_ready" })).ok).toBe(false);
  });
});
