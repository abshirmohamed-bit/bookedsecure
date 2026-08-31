import { describe, expect, it, vi } from "vitest";
import {
  CLASSIFIER_VERSION,
  DEFAULT_REVIEW,
  applyClassificationToReview,
  buildDryRunSummary,
  classifyRow,
  hasPhoneIssue,
  readClassification,
  readReview,
  resolveDecisionChange,
  resolveDuplicateStatus,
  type ClassifiableRow,
  type DuplicateLookup,
  type ReviewableRow,
  type RowClassification,
} from "@/lib/row-review";
import { flagInBatchDuplicates, parseCsv, prepareRow } from "@/lib/csv-import";

const CHECKED: DuplicateLookup = { state: "checked" };
const NOT_CHECKED: DuplicateLookup = { state: "not_checked" };
const ERRORED: DuplicateLookup = { state: "error" };

function clean(overrides: Partial<ClassifiableRow> = {}): ClassifiableRow {
  return {
    name: "Harry",
    email: "harry@example.com",
    mobile_number: "+61412345678",
    validation_errors: [],
    dedupe_match_lead_id: null,
    duplicate_of_row: null,
    ...overrides,
  };
}

/** 23-row real-shaped Meta lead-ads export: 19 clean, 4 phone issues, 0 dupes. */
function realExport(): {
  row_number: number;
  payload: ReturnType<typeof prepareRow>["normalized_payload"];
  row: ClassifiableRow;
}[] {
  const header = "full_name,phone_number,email,created_time,platform,is_organic,form_name";
  const lines = [header];
  for (let i = 0; i < 18; i += 1) {
    const mobile = `04${String(10000000 + i).padStart(8, "0")}`;
    lines.push(`Clean ${i},${mobile},clean${i}@example.com,1/13/26,fb,false,Detail Quote`);
  }
  lines.push("Harry,0412999111,harry@example.com,1/13/26,fb,false,Detail Quote");
  lines.push("aislop,0299998888,aislop@example.com,1/14/26,ig,false,Detail Quote");
  lines.push("Landline Two,0388887777,land2@example.com,1/14/26,fb,true,Detail Quote");
  lines.push("Bad Phone,12345,bad1@example.com,1/15/26,fb,false,Detail Quote");
  lines.push("No Phone,,nophone@example.com,1/15/26,ig,false,Detail Quote");

  const table = parseCsv(lines.join("\n"));
  const prepared = flagInBatchDuplicates(
    table.rows.map((values, index) => prepareRow(table.headers, values, index + 1)),
  );
  return prepared.map((prep) => ({
    row_number: prep.row_number,
    payload: prep.normalized_payload,
    row: {
      name: prep.normalized_payload.name,
      email: prep.normalized_payload.email,
      mobile_number: prep.normalized_payload.mobile_number,
      validation_errors: prep.validation_errors,
      dedupe_match_lead_id: null,
      duplicate_of_row: prep.duplicate_of_row,
    },
  }));
}

function reviewable(
  row: ClassifiableRow,
  rowNumber: number,
  classification: RowClassification,
  review = applyClassificationToReview({ ...DEFAULT_REVIEW }, classification),
): ReviewableRow {
  return {
    row_number: rowNumber,
    mobile_number: row.mobile_number,
    validation_errors: row.validation_errors,
    dedupe_match_lead_id: row.dedupe_match_lead_id,
    duplicate_of_row: row.duplicate_of_row,
    review,
    classification,
  };
}

describe("automated preview classification", () => {
  it("auto-includes a clean row only after a verified no-match lookup", () => {
    const verified = classifyRow(clean(), CHECKED);
    expect(verified).toMatchObject({
      classification: "auto_include",
      classification_reasons: ["clean_eligible"],
      duplicate_status: "checked_no_match",
      classifier_version: CLASSIFIER_VERSION,
    });
    expect(applyClassificationToReview({ ...DEFAULT_REVIEW }, verified).decision).toBe("include");
  });

  it("leaves the row pending when the duplicate lookup is unavailable", () => {
    const result = classifyRow(clean(), NOT_CHECKED);
    expect(result.classification).toBe("manual_review");
    expect(result.duplicate_status).toBe("not_checked");
    expect(result.classification_reasons).toContain("duplicate_check_unavailable");
    expect(applyClassificationToReview({ ...DEFAULT_REVIEW }, result).decision).toBe("pending");
  });

  it("leaves the row pending when the duplicate lookup errored", () => {
    const result = classifyRow(clean(), ERRORED);
    expect(result.duplicate_status).toBe("lookup_error");
    expect(result.classification_reasons).toContain("duplicate_lookup_error");
    expect(applyClassificationToReview({ ...DEFAULT_REVIEW }, result).decision).toBe("pending");
  });

  it("keeps a potential duplicate pending", () => {
    const byId = classifyRow(clean({ dedupe_match_lead_id: "lead-1" }), CHECKED);
    expect(byId.duplicate_status).toBe("potential_duplicate");
    expect(byId.classification_reasons).toContain("potential_duplicate");
    const inFile = classifyRow(clean({ duplicate_of_row: 2 }), CHECKED);
    expect(inFile.classification).toBe("manual_review");
    expect(applyClassificationToReview({ ...DEFAULT_REVIEW }, byId).decision).toBe("pending");
  });

  it("never auto-includes rows with data problems and never auto-excludes", () => {
    const cases: [Partial<ClassifiableRow>, string][] = [
      [{ name: null, validation_errors: [{ code: "missing_name" }] }, "missing_name"],
      [
        { mobile_number: null, validation_errors: [{ code: "unsupported_phone_type" }] },
        "not_mobile",
      ],
      [{ mobile_number: null, validation_errors: [{ code: "invalid_phone" }] }, "invalid_phone"],
      [{ mobile_number: null, validation_errors: [] }, "missing_phone"],
      [{ email: null, validation_errors: [{ code: "invalid_email" }] }, "invalid_email"],
      [{ email: null, validation_errors: [] }, "missing_email"],
      [{ validation_errors: [{ code: "malformed_row" }] }, "uncertain_data"],
      [{ validation_errors: [{ code: "something_new" }] }, "uncertain_data"],
    ];
    for (const [overrides, reason] of cases) {
      const result = classifyRow(clean(overrides), CHECKED);
      expect(result.classification).toBe("manual_review");
      expect(result.classification_reasons).toContain(reason);
      const review = applyClassificationToReview({ ...DEFAULT_REVIEW }, result);
      expect(review.decision).toBe("pending");
      expect(review.decision).not.toBe("exclude");
    }
  });

  it("does not reject a suspicious-looking but valid email", () => {
    const result = classifyRow(clean({ email: "test@com.au" }), CHECKED);
    expect(result.classification).toBe("auto_include");
  });

  it("resolves explicit duplicate lookup states", () => {
    const row = { dedupe_match_lead_id: null, duplicate_of_row: null };
    expect(resolveDuplicateStatus(row, NOT_CHECKED)).toBe("not_checked");
    expect(resolveDuplicateStatus(row, ERRORED)).toBe("lookup_error");
    expect(resolveDuplicateStatus(row, CHECKED)).toBe("checked_no_match");
    expect(resolveDuplicateStatus({ ...row, dedupe_match_lead_id: "x" }, CHECKED)).toBe(
      "potential_duplicate",
    );
  });
});

describe("manual decisions and idempotency", () => {
  it("preserves manual include and exclude decisions", () => {
    const manualExclude = resolveDecisionChange(
      { mobile_number: null, validation_errors: [{ code: "unsupported_phone_type" }] },
      { decision: "exclude", exclusion_reason: "not_mobile" },
    );
    const verified = classifyRow(clean(), CHECKED);
    expect(applyClassificationToReview(manualExclude, verified)).toEqual(manualExclude);

    const manualInclude = resolveDecisionChange(
      { mobile_number: "+61412345678", validation_errors: [] },
      { decision: "include" },
    );
    expect(applyClassificationToReview(manualInclude, classifyRow(clean(), NOT_CHECKED))).toEqual(
      manualInclude,
    );
  });

  it("is idempotent across repeated runs", () => {
    const row = clean();
    const first = classifyRow(row, CHECKED, new Date("2026-08-30T00:00:00Z"));
    const second = classifyRow(row, CHECKED, new Date("2026-08-30T00:00:00Z"));
    expect(second).toEqual(first);
    const once = applyClassificationToReview({ ...DEFAULT_REVIEW }, first);
    expect(applyClassificationToReview(once, second)).toEqual(once);
    // raw + normalized data is never part of the classifier's output
    expect(Object.keys(first).sort()).toEqual([
      "classification",
      "classification_reasons",
      "classified_at",
      "classifier_version",
      "duplicate_status",
    ]);
  });

  it("renders legacy rows without a review object as pending", () => {
    expect(readReview({}).decision).toBe("pending");
    expect(readReview(null).decision).toBe("pending");
    expect(readClassification({})).toMatchObject({
      classification: "manual_review",
      duplicate_status: "not_checked",
    });
    const summary = buildDryRunSummary([
      {
        row_number: 1,
        mobile_number: "+61412345678",
        validation_errors: [],
        dedupe_match_lead_id: null,
        duplicate_of_row: null,
      } as unknown as ReviewableRow,
    ]);
    expect(summary.pending_rows).toBe(1);
    expect(summary.duplicate_lookup_verified).toBe(false);
    expect(summary.potential_duplicates).toBeNull();
  });

  it("treats a stored manual pending as manual", () => {
    const manualPending = resolveDecisionChange(
      { mobile_number: "+61412345678", validation_errors: [] },
      { decision: "pending" },
    );
    expect(readReview({ review: manualPending }).source).toBe("manual");
    expect(applyClassificationToReview(manualPending, classifyRow(clean(), CHECKED))).toEqual(
      manualPending,
    );
  });
});

describe("dry-run summary for the real 23-row export", () => {
  it("keeps 23 rows, 19 clean and 4 phone-issue rows with an unverified lookup", () => {
    const rows = realExport();
    expect(rows).toHaveLength(23);
    const reviewable23 = rows.map((entry) =>
      reviewable(entry.row, entry.row_number, classifyRow(entry.row, NOT_CHECKED)),
    );
    expect(reviewable23.filter((r) => hasPhoneIssue(r))).toHaveLength(4);
    expect(reviewable23.filter((r) => !hasPhoneIssue(r))).toHaveLength(19);

    const summary = buildDryRunSummary(reviewable23);
    expect(summary).toMatchObject({
      total_rows: 23,
      pending_rows: 23,
      included_rows: 0,
      auto_included_rows: 0,
      manually_included_rows: 0,
      excluded_rows: 0,
      duplicate_lookup_status: "not_checked",
      duplicate_lookup_verified: false,
      duplicate_not_checked_rows: 23,
      potential_duplicates: null,
    });
    expect(summary.classification_reason_counts["duplicate_check_unavailable"]).toBe(23);
  });

  it("auto-includes the 19 clean rows once the lookup verifies no matches", () => {
    const rows = realExport();
    const summary = buildDryRunSummary(
      rows.map((entry) => reviewable(entry.row, entry.row_number, classifyRow(entry.row, CHECKED))),
    );
    expect(summary).toMatchObject({
      total_rows: 23,
      included_rows: 19,
      auto_included_rows: 19,
      manually_included_rows: 0,
      pending_rows: 4,
      excluded_rows: 0,
      duplicate_lookup_status: "checked_no_match",
      duplicate_lookup_verified: true,
      potential_duplicates: 0,
      included_with_phone_issues: 0,
      included_with_valid_au_mobile: 19,
      would_skip_as_duplicate: 0,
      would_block_sms_phone_ineligible: 0,
    });
    expect(summary.classification_reason_counts["clean_eligible"]).toBe(19);
  });

  it("reproduces the manual test summary: pending 21, included 1, excluded 1", () => {
    const rows = realExport();
    const reviewed = rows.map((entry) => {
      const classification = classifyRow(entry.row, NOT_CHECKED);
      if (entry.payload.name === "Harry") {
        return reviewable(
          entry.row,
          entry.row_number,
          classification,
          resolveDecisionChange(entry.row, { decision: "include" }),
        );
      }
      if (entry.payload.name === "aislop") {
        return reviewable(
          entry.row,
          entry.row_number,
          classification,
          resolveDecisionChange(entry.row, {
            decision: "exclude",
            exclusion_reason: "not_mobile",
          }),
        );
      }
      return reviewable(entry.row, entry.row_number, classification);
    });

    const summary = buildDryRunSummary(reviewed);
    expect(summary).toMatchObject({
      total_rows: 23,
      pending_rows: 21,
      included_rows: 1,
      manually_included_rows: 1,
      auto_included_rows: 0,
      excluded_rows: 1,
      included_with_valid_au_mobile: 1,
      included_with_phone_issues: 0,
    });

    // reloading staged data preserves the decisions and reasons
    const roundTripped = reviewed.map((row) => readReview({ review: row.review }));
    expect(roundTripped.filter((r) => r.decision === "include")).toHaveLength(1);
    const excluded = roundTripped.find((r) => r.decision === "exclude");
    expect(excluded?.exclusion_reason).toBe("not_mobile");

    // classification never overwrites those manual decisions
    const rerun = reviewed.map((row) =>
      applyClassificationToReview(row.review, row.classification!),
    );
    expect(rerun).toEqual(reviewed.map((row) => row.review));
  });
});

describe("preview-only safety boundary for classification", () => {
  it("classification is pure: no IO, no provider calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    classifyRow(clean(), CHECKED);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("the duplicate preflight only selects from leads and is tenant-scoped", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/csv-import.server.ts", "utf8"),
    );
    const start = source.indexOf("async function loadExistingIndex");
    const preflight = source.slice(start, source.indexOf("export async function previewCrmCsv"));
    expect(preflight).toContain('from("leads")');
    expect(preflight).toContain('.eq("business_id", businessId)');
    for (const forbidden of ["insert(", "update(", "delete(", "upsert("]) {
      expect(preflight).not.toContain(forbidden);
    }
  });

  it("the reclassifier writes only staged rows and never the legacy decision column", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/csv-import.server.ts", "utf8"),
    );
    const writer = (() => {
      const start = source.indexOf("export async function classifyPreviewBatch");
      const next = source.indexOf("\nexport ", start + 1);
      return next === -1 ? source.slice(start) : source.slice(start, next);
    })();
    expect(writer).toContain('from("lead_import_rows")');
    expect(writer).toContain("normalized_payload");
    expect(writer).not.toContain("decision:");
    for (const forbidden of [
      'from("leads")',
      'from("messages")',
      'from("conversations")',
      'from("jobs")',
      'from("automation_jobs")',
      "sendSms",
      "sendEmail",
      "captureLead",
      "telnyx",
      "sinch",
      "fetch(",
    ]) {
      expect(writer.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
