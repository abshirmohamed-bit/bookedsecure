import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRepairSummary,
  matchesRepairFilter,
  repairPhone,
  stampRepair,
} from "@/lib/phone-repair";
import { prepareRow, flagInBatchDuplicates, flagExistingDuplicates } from "@/lib/csv-import";

describe("phone repair engine (Australia only)", () => {
  it("normalises a local Australian mobile", () => {
    const r = repairPhone("0404398423");
    expect(r.normalized).toBe("+61404398423");
    expect(r.confidence).toBe("high");
    expect(r.classification).toBe("repaired_au_mobile");
  });

  it("normalises a spaced Australian mobile", () => {
    expect(repairPhone("0404 398 423").normalized).toBe("+61404398423");
  });

  it("normalises a punctuated Australian mobile", () => {
    expect(repairPhone("(04) 04-398.423").normalized).toBe("+61404398423");
  });

  it("keeps a canonical +61 mobile unchanged", () => {
    const r = repairPhone("+61404398423");
    expect(r.normalized).toBe("+61404398423");
    expect(r.action).toBe("no_change");
    expect(r.classification).toBe("valid_au_mobile");
  });

  it("normalises a spaced +61 mobile", () => {
    expect(repairPhone("+61 404 398 423").normalized).toBe("+61404398423");
  });

  it("removes an extra trunk zero after the country code", () => {
    for (const input of ["+61 0404 398 423", "+610404398423", "610404398423"]) {
      const r = repairPhone(input);
      expect(r.normalized).toBe("+61404398423");
      expect(r.actions).toContain("removed_extra_trunk_zero");
      expect(r.confidence).toBe("high");
    }
    expect(repairPhone("+610450802677").normalized).toBe("+61450802677");
  });

  it("normalises a nine-digit mobile with no trunk prefix or country code", () => {
    const r = repairPhone("424012949");
    expect(r.normalized).toBe("+61424012949");
    expect(r.confidence).toBe("high");
    expect(r.classification).toBe("repaired_au_mobile");
    expect(r.actions).toContain("added_country_code");
    expect(r.reason).toContain("added +61");
  });

  it("classifies an incorrect digit count as unrepairable", () => {
    const r = repairPhone("04043984");
    expect(r.normalized).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.classification).toBe("incomplete_phone");
  });

  it("classifies a truly incomplete number", () => {
    const r = repairPhone("0404");
    expect(r.classification).toBe("incomplete_phone");
    expect(r.normalized).toBeNull();
  });

  it("classifies an ambiguous number", () => {
    const r = repairPhone("298765432");
    expect(r.classification).toBe("ambiguous_phone");
    expect(r.confidence).toBe("medium");
  });

  it("recognises an Australian landline as non-mobile", () => {
    const r = repairPhone("02 9876 5432");
    expect(r.normalized).toBe("+61298765432");
    expect(r.classification).toBe("valid_au_landline");
  });

  it("treats an empty phone as empty, not invalid", () => {
    const r = repairPhone("   ");
    expect(r.classification).toBe("empty_phone");
    expect(r.normalized).toBeNull();
    expect(r.confidence).toBe("none");
  });

  it("never repairs an explicit non-Australian country code", () => {
    for (const input of ["+1 415 555 0132", "+64 21 123 4567", "0011 61 404 398 423"]) {
      const r = repairPhone(input);
      expect(r.normalized).toBeNull();
      expect(r.applied).toBe(false);
      expect(r.classification).not.toBe("repaired_au_mobile");
    }
  });

  it("never invents or alters a subscriber digit", () => {
    const inputs = [
      "0404398423",
      "0404 398 423",
      "+61404398423",
      "+61 404 398 423",
      "+61 0404 398 423",
      "+610404398423",
      "+610450802677",
      "424012949",
    ];
    for (const input of inputs) {
      const r = repairPhone(input);
      expect(r.original).toBe(input);
      const subscriber = r.normalized!.slice(-9);
      // Every repaired digit must already appear, in order, in the raw input.
      const rawDigits = input.replace(/\D/g, "");
      expect(rawDigits.endsWith(subscriber)).toBe(true);
    }
  });

  it("is idempotent: re-running the engine keeps the same normalized value", () => {
    const first = repairPhone("424012949");
    const second = repairPhone(first.original);
    const third = repairPhone(first.normalized!);
    expect(second.normalized).toBe(first.normalized);
    expect(third.normalized).toBe(first.normalized);
    expect(second.action).toBe(first.action);
  });

  it("preserves the first repair timestamp and provenance on re-stamp", () => {
    const first = stampRepair(repairPhone("0404398423"), {
      stagedRowId: "row-1",
      batchId: "batch-1",
      at: "2026-01-01T00:00:00.000Z",
    });
    const second = stampRepair(repairPhone("0404398423"), {
      stagedRowId: "row-1",
      batchId: "batch-1",
      at: "2026-02-02T00:00:00.000Z",
      previous: first,
    });
    expect(second.repaired_at).toBe(first.repaired_at);
    expect(second.staged_row_id).toBe("row-1");
    expect(second.batch_id).toBe("batch-1");
    expect(second.normalized).toBe(first.normalized);
  });
});

describe("repair inside the staged import pipeline", () => {
  const headers = ["Name", "Email", "Phone"];

  it("applies high-confidence repairs during row preparation and keeps the raw value", () => {
    const row = prepareRow(headers, ["Harry", "harry@example.com", "424012949"], 1);
    expect(row.normalized_payload.mobile_number).toBe("+61424012949");
    expect(row.raw_row["Phone"]).toBe("424012949");
    expect(row.normalized_payload.source_metadata["phone_raw"]).toBe("424012949");
    expect(row.normalized_payload.phone_repair?.confidence).toBe("high");
    expect(row.validation_errors.map((issue) => issue.code)).not.toContain("invalid_phone");
  });

  it("keeps unrepairable phones as exceptions", () => {
    const row = prepareRow(headers, ["Sam", "sam@example.com", "0404"], 1);
    expect(row.normalized_payload.mobile_number).toBeNull();
    expect(row.validation_errors.map((issue) => issue.code)).toContain("invalid_phone");
  });

  it("keeps missing-name and missing-contact rows pending", () => {
    const noName = prepareRow(headers, ["", "sam@example.com", "0404398423"], 1);
    expect(noName.validation_errors.map((i) => i.code)).toContain("missing_name");
    const noContact = prepareRow(headers, ["Sam", "", "0404"], 2);
    expect(noContact.validation_errors.map((i) => i.code)).toContain("missing_phone_and_email");
  });

  it("accepts an empty phone when a valid email exists", () => {
    const row = prepareRow(headers, ["Sam", "sam@example.com", ""], 1);
    expect(row.validation_errors).toEqual([]);
  });

  it("detects an in-batch duplicate only after normalisation", () => {
    const rows = flagInBatchDuplicates([
      prepareRow(headers, ["Harry", "harry@example.com", "+61424012949"], 1),
      prepareRow(headers, ["Harry Two", "harry2@example.com", "424012949"], 2),
    ]);
    expect(rows[1]!.duplicate_of_row).toBe(1);
    expect(rows[1]!.validation_errors.map((i) => i.code)).toContain("duplicate_phone_in_file");
  });

  it("detects an existing-lead duplicate after normalisation", () => {
    const rows = flagExistingDuplicates(
      [prepareRow(headers, ["Harry", "harry@example.com", "424012949"], 1)],
      { byPhone: new Map([["+61424012949", "lead-1"]]), byEmail: new Map() },
    );
    expect(rows[0]!.dedupe_match_lead_id).toBe("lead-1");
    expect(rows[0]!.validation_errors.map((i) => i.code)).toContain("duplicate_existing_phone");
  });
});

describe("repair summary and filters", () => {
  const rows = [
    { normalized_payload: { phone_repair: stampRepair(repairPhone("0404398423"), {}) } },
    { normalized_payload: { phone_repair: stampRepair(repairPhone("+61450802677"), {}) } },
    { normalized_payload: { phone_repair: stampRepair(repairPhone("02 9876 5432"), {}) } },
    { normalized_payload: { phone_repair: stampRepair(repairPhone("0404"), {}) } },
    {
      normalized_payload: {
        phone_repair: stampRepair(repairPhone("424012949"), {}),
      },
      duplicate_of_row: 1,
      classification: { classification: "manual_review" },
    },
    {
      normalized_payload: { phone_repair: stampRepair(repairPhone("0451111111"), {}) },
      classification: { classification: "auto_include" },
    },
  ];

  it("counts each phone class distinctly", () => {
    const summary = buildRepairSummary(rows as never);
    expect(summary.rows_scanned).toBe(6);
    expect(summary.high_confidence_applied).toBe(3);
    expect(summary.repaired_au_mobiles).toBe(3);
    expect(summary.valid_au_mobiles).toBe(1);
    expect(summary.valid_au_landlines).toBe(1);
    expect(summary.incomplete_phones).toBe(1);
    expect(summary.potential_duplicates).toBe(1);
    expect(summary.auto_include_candidates).toBe(1);
    expect(summary.nine_digit_mobile_repairs).toBe(1);
  });

  it("filters rows by repair state", () => {
    expect(rows.filter((r) => matchesRepairFilter(r as never, "repaired_automatically")).length).toBe(3);
    expect(rows.filter((r) => matchesRepairFilter(r as never, "non_mobile")).length).toBe(1);
    expect(rows.filter((r) => matchesRepairFilter(r as never, "potential_duplicate")).length).toBe(
      1,
    );
    expect(rows.filter((r) => matchesRepairFilter(r as never, "auto_include_candidate")).length).toBe(1);
    expect(rows.filter((r) => matchesRepairFilter(r as never, "all")).length).toBe(6);
  });
});

describe("repair summary defensive reads", () => {
  it("tolerates a phone_repair record with missing actions", () => {
    const repair = repairPhone("0404398423");
    const { actions, ...rest } = repair;
    const rows = [{ normalized_payload: { phone_repair: rest } }];
    const summary = buildRepairSummary(rows as never);
    expect(summary.rows_scanned).toBe(1);
    expect(summary.repaired_au_mobiles).toBe(1);
    expect(summary.extra_trunk_zero_repairs).toBe(0);
    expect(summary.nine_digit_mobile_repairs).toBe(0);
  });

  it("tolerates a phone_repair record with an empty actions array", () => {
    const repair = { ...repairPhone("0404398423"), actions: [] as const };
    const rows = [{ normalized_payload: { phone_repair: repair } }];
    const summary = buildRepairSummary(rows as never);
    expect(summary.rows_scanned).toBe(1);
    expect(summary.repaired_au_mobiles).toBe(1);
    expect(summary.extra_trunk_zero_repairs).toBe(0);
  });

  it("ignores malformed actions while keeping valid metadata", () => {
    const repair = {
      ...repairPhone("+610404398423"),
      actions: ["removed_extra_trunk_zero", "not_a_real_action", 123, null] as unknown[],
    };
    const rows = [{ normalized_payload: { phone_repair: repair } }];
    const summary = buildRepairSummary(rows as never);
    expect(summary.rows_scanned).toBe(1);
    expect(summary.repaired_au_mobiles).toBe(1);
    expect(summary.extra_trunk_zero_repairs).toBe(1);
  });

  it("keeps normal summary output unchanged for a complete record", () => {
    const rows = [
      { normalized_payload: { phone_repair: stampRepair(repairPhone("0404398423"), {}) } },
      { normalized_payload: { phone_repair: stampRepair(repairPhone("+61450802677"), {}) } },
      { normalized_payload: { phone_repair: stampRepair(repairPhone("02 9876 5432"), {}) } },
      { normalized_payload: { phone_repair: stampRepair(repairPhone("0404"), {}) } },
    ];
    const summary = buildRepairSummary(rows as never);
    expect(summary.rows_scanned).toBe(4);
    expect(summary.high_confidence_applied).toBe(2);
    expect(summary.repaired_au_mobiles).toBe(2);
    expect(summary.valid_au_mobiles).toBe(1);
    expect(summary.valid_au_landlines).toBe(1);
    expect(summary.incomplete_phones).toBe(1);
  });
});

describe("repair safety boundary", () => {
  it("the repair engine has no IO, provider, lead, message or automation code", () => {
    const source = readFileSync("src/lib/phone-repair.ts", "utf8");
    for (const forbidden of [
      "supabase",
      "from(",
      "insert",
      "update",
      "fetch(",
      "sendSms",
      "telnyx",
      "createServerFn",
      "createClient",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
