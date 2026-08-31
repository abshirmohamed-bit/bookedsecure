import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REVIEW,
  DRY_RUN_LABEL,
  RowDecisionError,
  buildDryRunSummary,
  hasPhoneIssue,
  isEligibleMobile,
  readReview,
  resolveDecisionChange,
  type ReviewableRow,
} from "@/lib/row-review";
import { flagInBatchDuplicates, parseCsv, prepareRow } from "@/lib/csv-import";

function row(overrides: Partial<ReviewableRow> = {}): ReviewableRow {
  return {
    row_number: 1,
    mobile_number: "+61412345678",
    validation_errors: [],
    dedupe_match_lead_id: null,
    duplicate_of_row: null,
    review: { ...DEFAULT_REVIEW },
    ...overrides,
  };
}

/** 23-row real-shaped Meta lead-ads export: 19 clean, 4 phone issues, 0 dupes. */
function realExportRows(): ReviewableRow[] {
  const header = "full_name,phone_number,email,created_time,platform,is_organic,form_name";
  const lines = [header];
  for (let i = 0; i < 19; i += 1) {
    const mobile = `04${String(10000000 + i).padStart(8, "0")}`;
    lines.push(`Clean ${i},${mobile},clean${i}@example.com,1/13/26,fb,false,Detail Quote`);
  }
  lines.push("Landline One,0299998888,land1@example.com,1/14/26,ig,false,Detail Quote");
  lines.push("Landline Two,0388887777,land2@example.com,1/14/26,fb,true,Detail Quote");
  lines.push("Bad Phone,12345,bad1@example.com,1/15/26,fb,false,Detail Quote");
  lines.push("No Phone,,nophone@example.com,1/15/26,ig,false,Detail Quote");

  const table = parseCsv(lines.join("\n"));
  const prepared = flagInBatchDuplicates(
    table.rows.map((values, index) => prepareRow(table.headers, values, index + 1)),
  );
  return prepared.map((prep) => ({
    row_number: prep.row_number,
    mobile_number: prep.normalized_payload.mobile_number,
    validation_errors: prep.validation_errors,
    dedupe_match_lead_id: null,
    duplicate_of_row: prep.duplicate_of_row,
    review: readReview(prep.normalized_payload),
  }));
}

describe("row review decisions", () => {
  it("defaults every row to pending", () => {
    const rows = realExportRows();
    expect(rows).toHaveLength(23);
    expect(rows.every((r) => r.review.decision === "pending")).toBe(true);
    expect(rows.every((r) => r.review.exclusion_reason === null)).toBe(true);
    expect(readReview({}).decision).toBe("pending");
    expect(readReview(null).decision).toBe("pending");
  });

  it("lets a clean row be changed to include", () => {
    expect(resolveDecisionChange(row(), { decision: "include" })).toEqual({
      decision: "include",
      exclusion_reason: null,
      source: "manual",
    });
  });

  it("never auto-includes a row with a phone issue", () => {
    const issues: ReviewableRow[] = [
      row({ mobile_number: null, validation_errors: [{ code: "invalid_phone" }] }),
      row({ mobile_number: null, validation_errors: [{ code: "unsupported_phone_type" }] }),
      row({ mobile_number: null, validation_errors: [{ code: "missing_phone_and_email" }] }),
    ];
    for (const candidate of issues) {
      expect(hasPhoneIssue(candidate)).toBe(true);
      expect(() => resolveDecisionChange(candidate, { decision: "include" })).toThrow(
        RowDecisionError,
      );
      // may stay pending or be manually excluded
      expect(resolveDecisionChange(candidate, { decision: "pending" }).decision).toBe("pending");
      expect(
        resolveDecisionChange(candidate, { decision: "exclude", exclusion_reason: "not_mobile" }),
      ).toEqual({ decision: "exclude", exclusion_reason: "not_mobile", source: "manual" });
    }
  });

  it("requires and preserves an exclusion reason", () => {
    expect(() => resolveDecisionChange(row(), { decision: "exclude" })).toThrow(RowDecisionError);
    expect(() =>
      resolveDecisionChange(row(), { decision: "exclude", exclusion_reason: "nope" }),
    ).toThrow(RowDecisionError);
    const excluded = resolveDecisionChange(row(), {
      decision: "exclude",
      exclusion_reason: "bad_data",
    });
    expect(excluded.exclusion_reason).toBe("bad_data");
    expect(readReview({ review: excluded }).exclusion_reason).toBe("bad_data");
  });

  it("rejects unknown decisions", () => {
    expect(() => resolveDecisionChange(row(), { decision: "approve" })).toThrow(RowDecisionError);
  });

  it("changing a decision performs no live writes or provider calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = JSON.parse(JSON.stringify(row()));
    const next = resolveDecisionChange(before, { decision: "include" });
    expect(next.decision).toBe("include");
    // the pure decision path never performs IO of any kind
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps all 23 rows visible: 19 clean and 4 with phone issues", () => {
    const rows = realExportRows();
    const withIssues = rows.filter((r) => hasPhoneIssue(r));
    expect(rows).toHaveLength(23);
    expect(withIssues).toHaveLength(4);
    expect(rows.filter((r) => !hasPhoneIssue(r))).toHaveLength(19);
    expect(rows.filter((r) => r.duplicate_of_row !== null)).toHaveLength(0);
  });

  it("computes dry-run totals for the 23-row export", () => {
    const rows = realExportRows();
    const initial = buildDryRunSummary(rows);
    expect(initial).toMatchObject({
      label: DRY_RUN_LABEL,
      total_rows: 23,
      pending_rows: 23,
      included_rows: 0,
      excluded_rows: 0,
      included_with_phone_issues: 0,
      included_with_valid_au_mobile: 0,
      potential_existing_duplicates: 0,
      would_skip_as_duplicate: 0,
      would_block_sms_phone_ineligible: 0,
    });

    // include all clean rows, exclude the four phone-issue rows
    const reviewed = rows.map((candidate) =>
      hasPhoneIssue(candidate)
        ? {
            ...candidate,
            review: resolveDecisionChange(candidate, {
              decision: "exclude",
              exclusion_reason: "not_mobile",
            }),
          }
        : { ...candidate, review: resolveDecisionChange(candidate, { decision: "include" }) },
    );
    const summary = buildDryRunSummary(reviewed);
    expect(summary).toMatchObject({
      total_rows: 23,
      pending_rows: 0,
      included_rows: 19,
      excluded_rows: 4,
      included_with_phone_issues: 0,
      included_with_valid_au_mobile: 19,
      would_block_sms_phone_ineligible: 0,
    });

    // one included row matching an existing lead is counted as a skip
    const withDuplicate = reviewed.map((candidate, index) =>
      index === 0 ? { ...candidate, dedupe_match_lead_id: "lead-1" } : candidate,
    );
    const dupSummary = buildDryRunSummary(withDuplicate);
    expect(dupSummary.potential_existing_duplicates).toBe(1);
    expect(dupSummary.would_skip_as_duplicate).toBe(1);
  });

  it("classifies AU mobile eligibility", () => {
    expect(isEligibleMobile("+61412345678")).toBe(true);
    expect(isEligibleMobile("+61299998888")).toBe(false);
    expect(isEligibleMobile(null)).toBe(false);
  });
});

describe("preview-only boundary for the review layer", () => {
  it("row-review module contains no lead, message, job, automation or provider IO", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/row-review.ts", "utf8"),
    );
    for (const forbidden of [
      "from(\"leads\")",
      "from(\"messages\")",
      "from(\"conversations\")",
      "from(\"jobs\")",
      "from(\"automation_jobs\")",
      "captureLead",
      "telnyx",
      "sinch",
      "twilio",
      "fetch(",
      "supabase",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("the decision writer only updates staged import rows", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/csv-import.server.ts", "utf8"),
    );
    const writer = (() => {
      const start = source.indexOf("export async function setRowReviewDecision");
      const next = source.indexOf("\nexport ", start + 1);
      return next === -1 ? source.slice(start) : source.slice(start, next);
    })();
    expect(writer).toContain('from("lead_import_rows")');
    expect(writer).toContain('from("import_batches")');
    for (const forbidden of [
      'from("leads")',
      'from("messages")',
      'from("conversations")',
      'from("jobs")',
      'from("automation_jobs")',
      "insert(",
      "delete(",
      "sendSms",
      "sendEmail",
      "captureLead",
    ]) {
      expect(writer).not.toContain(forbidden);
    }
  });
});
