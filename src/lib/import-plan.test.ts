import { describe, expect, it } from "vitest";
import {
  deriveName,
  mapSourceChannel,
  prepareRow,
  parseCsv,
  resolveSourceChannel,
} from "@/lib/csv-import";
import { planImport, planImportRow, planSummaryLines, saveHeadline, buildSaveReport } from "@/lib/import-plan";

const row = (over: Partial<Parameters<typeof planImportRow>[0]> = {}) => ({
  row_number: 1,
  name: "Jo Smith",
  mobile_number: "+61412345678",
  email: null,
  validation_errors: [] as { code: string }[],
  dedupe_match_lead_id: null,
  duplicate_of_row: null,
  ...over,
});

describe("name recovery", () => {
  it("prefers an explicit name, then first/last, then the email wording", () => {
    expect(deriveName({ name: " Jo  Smith " })).toBe("Jo Smith");
    expect(deriveName({ firstName: "Jo", lastName: "Smith" })).toBe("Jo Smith");
    expect(deriveName({ firstName: "Jo" })).toBe("Jo");
    expect(deriveName({ email: "jane.smith88@example.com" })).toBe("Jane Smith");
    expect(deriveName({ email: "info@example.com" })).toBe("Info");
    expect(deriveName({ email: "12345@example.com" })).toBeNull();
    expect(deriveName({})).toBeNull();
    // A yes/no flag mapped to the name column never becomes the name.
    expect(deriveName({ name: "true", firstName: "Jo", lastName: "Smith" })).toBe("Jo Smith");
    expect(deriveName({ name: "FALSE", email: "jane.smith@example.com" })).toBe("Jane Smith");
    expect(deriveName({ name: "true" })).toBeNull();
  });

  it("keeps split-name columns aligned to their own row", () => {
    const table = parseCsv("First Name,Surname,Mobile\nJo,Smith,0412345678\nSam,Lee,0412345679");
    const first = prepareRow(table.headers, table.rows[0]!, 1);
    const second = prepareRow(table.headers, table.rows[1]!, 2);
    expect(first.normalized_payload.name).toBe("Jo Smith");
    expect(first.normalized_payload.mobile_number).toBe("+61412345678");
    expect(second.normalized_payload.name).toBe("Sam Lee");
    expect(second.normalized_payload.mobile_number).toBe("+61412345679");
  });

  it("falls back to the contact's own number rather than dropping the row", () => {
    const table = parseCsv("Contact Number\n0412345678");
    const prepared = prepareRow(table.headers, table.rows[0]!, 1);
    expect(prepared.normalized_payload.name).toBe("+61412345678");
    expect(prepared.validation_errors.map((issue) => issue.code)).not.toContain("missing_name");
  });
});

describe("source recognition", () => {
  it("maps common vendor wording and free text", () => {
    expect(mapSourceChannel("GoDaddy Website")).toBe("godaddy");
    expect(mapSourceChannel("Facebook Lead Ads")).toBe("meta");
    expect(mapSourceChannel("enquiry from our go daddy site")).toBe("godaddy");
    expect(mapSourceChannel("something else")).toBe("unknown");
  });

  it("falls back to the platform column, then the file name", () => {
    expect(resolveSourceChannel({ sourceRaw: "", platformRaw: "fb" })).toBe("meta");
    expect(resolveSourceChannel({ filename: "godaddy-leads-export.csv" })).toBe("godaddy");
    expect(resolveSourceChannel({ filename: "contacts.csv" })).toBe("unknown");
  });
});

describe("import plan", () => {
  it("saves new contacts, updates matches, skips unusable rows", () => {
    expect(planImportRow(row()).bucket).toBe("save");
    expect(planImportRow(row({ dedupe_match_lead_id: "lead-1" })).bucket).toBe("update");
    expect(planImportRow(row({ duplicate_of_row: 1 })).bucket).toBe("skip");
    expect(planImportRow(row({ mobile_number: null })).skip_reason).toBe("no_mobile");
    expect(planImportRow(row({ mobile_number: "+61212345678" })).skip_reason).toBe("no_mobile");
    expect(planImportRow(row({ commit_lead_id: "lead-9" })).bucket).toBe("already_there");
  });

  it("a missing email never blocks a contact", () => {
    expect(planImportRow(row({ email: null })).bucket).toBe("save");
  });

  it("counts and describes the plan honestly", () => {
    const plan = planImport("batch-1", [
      row({ row_number: 1 }),
      row({ row_number: 2, dedupe_match_lead_id: "lead-1" }),
      row({ row_number: 3, mobile_number: null }),
    ]);
    expect(plan).toMatchObject({ total: 3, save: 1, update: 1, skipped: 1, already_there: 0 });
    expect(plan.actionable_rows).toEqual([1, 2]);
    const lines = planSummaryLines(plan).join(" ");
    expect(lines).toContain("We read 3 contacts");
    expect(lines).toContain("1 contact are already in your inbox".replace("are", "are"));
  });

  it("reports partial failure rather than a false success", () => {
    const report = buildSaveReport([
      { row_number: 1, name: "Jo", outcome: "saved", detail: null },
      { row_number: 2, name: "Sam", outcome: "failed", detail: "boom" },
    ]);
    expect(report).toMatchObject({ saved: 1, failed: 1 });
    expect(saveHeadline(report)).toContain("could not be saved");
  });
});
