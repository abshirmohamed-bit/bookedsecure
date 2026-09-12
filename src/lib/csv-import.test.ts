import { describe, expect, it, vi } from "vitest";
import {
  classifyAuPhone,
  mapStage,
  restageStage,
  normalizePlatform,
  parseCreatedAt,
  parseCsv,
  detectDelimiter,
  canonicalField,
  flagInBatchDuplicates,
  prepareRow,
  unmappedColumns,
} from "./csv-import";
import { previewCrmCsv, loadBatchPreview } from "./csv-import.server";

const GLOCAST = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const OWNER = "d935abe2-c2f0-42c4-9c8d-ab2ed459e08a";
const EXISTING_LEAD = "0df3a257-0000-4000-8000-000000000001";

const CSV = [
  "Name,Email,Phone,Source,Form,Stage,Created,Owner,Labels,Secondary phone,WhatsApp number,Vehicle rego",
  "Ada Lovelace,ADA@Example.com,0412 345 678,Facebook,Quote form,Quoted,12/03/2026,Sam,vip,0298765432,+61412345678,ABC123",
  "Bob Duplicate,bob@example.com,0412 345 678,Website,Web,New,,Sam,,,,XYZ999",
  "Carl Landline,carl@example.com,02 9876 5432,Website,Web,New,,,,,,",
  ",bad-email,not-a-phone,Website,Web,Weird Stage,,,,,,",
  "Dana Existing,dana@example.com,0466 907 824,Website,Web,New,,,,,,",
].join("\n");

/**
 * Minimal fake of the admin client that records every table it is asked to
 * touch, so tests can prove nothing outside the two import tables is written.
 */
function fakeClient(existingLeads: Record<string, unknown>[] = []) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const store: { batches: Record<string, unknown>[]; rows: Record<string, unknown>[] } = {
    batches: [],
    rows: [],
  };

  const client = {
    writes,
    store,
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const selectResult = (data: unknown): Record<string, unknown> => ({
        select: () => selectResult(data),
        eq: () => selectResult(data),
        order: () => Promise.resolve({ data, error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
        single: () => Promise.resolve({ data, error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      });

      builder["select"] = () => {
        if (table === "leads") return selectResult(existingLeads);
        if (table === "import_batches") return selectResult(store.batches[0] ?? null);
        if (table === "lead_import_rows") return selectResult(store.rows);
        return selectResult(null);
      };

      builder["insert"] = (payload: unknown) => {
        writes.push({ table, op: "insert", payload });
        const rows = Array.isArray(payload) ? payload : [payload];
        if (table === "import_batches") {
          const batch = {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            total_rows: 0,
            valid_rows: 0,
            invalid_rows: 0,
            duplicate_rows: 0,
            ...(rows[0] as Record<string, unknown>),
          };
          store.batches.push(batch);
          return selectResult(batch);
        }
        if (table === "lead_import_rows") store.rows.push(...(rows as Record<string, unknown>[]));
        return selectResult(rows[0] ?? null);
      };

      builder["update"] = (payload: Record<string, unknown>) => {
        writes.push({ table, op: "update", payload });
        if (table === "import_batches" && store.batches[0]) {
          Object.assign(store.batches[0], payload);
        }
        return selectResult(store.batches[0] ?? null);
      };

      return builder as never;
    },
  };
  return client;
}

describe("CRM CSV parsing and mapping", () => {
  it("requires a header row", () => {
    expect(() => parseCsv("0412345678,0412345679\n0412345670,0412345671")).toThrow(/header row/i);
    expect(() => parseCsv("")).toThrow(/empty/i);
  });

  it("normalises Australian mobiles and rejects other phone types", () => {
    expect(classifyAuPhone("0412 345 678")).toEqual({ kind: "mobile", value: "+61412345678" });
    expect(classifyAuPhone("02 9876 5432")).toEqual({
      kind: "unsupported_type",
      value: "+61298765432",
    });
    expect(classifyAuPhone("not-a-phone")).toEqual({ kind: "invalid" });
  });

  it("maps CRM stages and reports unmappable ones", () => {
    expect(mapStage("Quoted")).toBe("quote_sent");
    expect(mapStage("Closed Won")).toBe("completed");
    expect(mapStage("Weird Stage")).toBeNull();
  });

  it("maps historical GoDaddy CRM stages and preserves the raw stage text", () => {
    expect(mapStage("Intake")).toBe("previous_lead");
    expect(mapStage("  intake ")).toBe("previous_lead");
    expect(mapStage("Converted")).toBe("completed");
    expect(mapStage("converted")).toBe("completed");
    // Unknown future stages must stay exceptions rather than being guessed.
    expect(mapStage("Nurture 2026")).toBeNull();

    const headers = ["Name", "Phone", "Email", "Stage"];
    const intake = prepareRow(headers, ["Jo Smith", "0412345678", "jo@example.com", "Intake"], 1);
    expect(intake.normalized_payload.proposed_status).toBe("previous_lead");
    expect(intake.normalized_payload.source_metadata["stage_raw"]).toBe("Intake");
    expect(intake.validation_errors).toEqual([]);

    const converted = prepareRow(
      headers,
      ["Ada Lee", "0412345679", "ada@example.com", "Converted"],
      2,
    );
    expect(converted.normalized_payload.proposed_status).toBe("completed");
    expect(converted.normalized_payload.source_metadata["stage_raw"]).toBe("Converted");
    expect(converted.validation_errors).toEqual([]);

    const unknown = prepareRow(headers, ["Bo Ng", "0412345670", "bo@example.com", "Nurture"], 3);
    expect(unknown.normalized_payload.proposed_status).toBeNull();
    expect(unknown.validation_errors.map((e) => e.code)).toContain("unmappable_stage");
    expect(unknown.normalized_payload.source_metadata["stage_raw"]).toBe("Nurture");
  });

  it("preserves unknown columns and keeps metadata-only fields out of lead fields", () => {
    const table = parseCsv(CSV);
    expect(unmappedColumns(table.headers)).toEqual(["Vehicle rego"]);
    const row = prepareRow(table.headers, table.rows[0]!, 1);
    expect(row.raw_row["Vehicle rego"]).toBe("ABC123");
    expect(row.normalized_payload.source_metadata).toEqual({
      owner: "Sam",
      labels: "vip",
      secondary_phone: "0298765432",
      whatsapp_number: "+61412345678",
      created_at_raw: "12/03/2026",
      stage_raw: "Quoted",
      phone_raw: "0412 345 678",
    });
    expect(row.normalized_payload.email).toBe("ada@example.com");
    expect(row.normalized_payload.proposed_status).toBe("quote_sent");
    expect(row.normalized_payload.proposed_created_at).toContain("2026-03-12");
  });
});

describe("previewCrmCsv (preview only)", () => {
  const existing = [
    { id: EXISTING_LEAD, mobile_number: "+61466907824", email_normalised: null, email: null },
  ];

  it("creates exactly one batch plus import rows and writes nothing else", async () => {
    const client = fakeClient(existing);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "crm.csv",
      content: CSV,
    });

    const tables = [...new Set(client.writes.map((write) => write.table))].sort();
    expect(tables).toEqual(["import_batches", "lead_import_rows"]);
    expect(client.writes.filter((w) => w.table === "import_batches" && w.op === "insert")).toHaveLength(1);
    expect(client.store.rows).toHaveLength(5);
    expect(result.batch.status).toBe("previewed");
    expect(result.batch.total_rows).toBe(5);
    expect(result.rows.every((row) => row.decision === "pending")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("flags invalid phones, unsupported types, missing names and bad emails", async () => {
    const client = fakeClient(existing);
    const result = await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "crm.csv",
      content: CSV,
    });
    const codes = (n: number) =>
      result.rows.find((row) => row.row_number === n)!.validation_errors.map((e) => e.code);
    expect(codes(3)).toContain("unsupported_phone_type");
    expect(codes(4)).toEqual(
      expect.arrayContaining(["missing_name", "invalid_phone", "invalid_email", "missing_phone_and_email"]),
    );
  });

  it("flags duplicates inside the file and against existing leads", async () => {
    const client = fakeClient(existing);
    const result = await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "crm.csv",
      content: CSV,
    });
    const inFile = result.rows.find((row) => row.row_number === 2)!;
    expect(inFile.duplicate_of_row).toBe(1);
    expect(inFile.validation_errors.map((e) => e.code)).toContain("duplicate_phone_in_file");

    const existingMatch = result.rows.find((row) => row.row_number === 5)!;
    expect(existingMatch.dedupe_match_lead_id).toBe(EXISTING_LEAD);
    expect(existingMatch.validation_errors.map((e) => e.code)).toContain("duplicate_existing_phone");
  });

  it("emits both phone and email duplicate errors when a row matches on both", async () => {
    const client = fakeClient();
    const result = await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "both.csv",
      content: [
        "Name,Phone,Email",
        "First Lead,0419999999,dup@example.com",
        "Second Lead,0419999999,dup@example.com",
      ].join("\n"),
    });
    const dup = result.rows.find((row) => row.row_number === 2)!;
    expect(dup.duplicate_of_row).toBe(1);
    expect(dup.validation_errors).toEqual([
      { code: "duplicate_phone_in_file", field: "mobile_number", detail: "row 1" },
      { code: "duplicate_email_in_file", field: "email", detail: "row 1" },
    ]);
  });

  it("marks the batch failed and preserves details when parsing fails", async () => {
    const client = fakeClient();
    await expect(
      previewCrmCsv(client as never, {
        businessId: GLOCAST,
        userId: OWNER,
        filename: "broken.csv",
        content: '0412345678,"unterminated',
      }),
    ).rejects.toThrow();
    expect(client.store.batches[0]!["status"]).toBe("failed");
    expect(client.store.rows[0]!["validation_errors"]).toEqual([
      { code: "parse_failed", detail: expect.any(String) },
    ]);
  });

  it("does not expose a batch belonging to another tenant", async () => {
    const client = fakeClient();
    await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "crm.csv",
      content: CSV,
    });
    const batchId = client.store.batches[0]!["id"] as string;
    // The tenant-scoped read filters on business_id; simulate a foreign tenant.
    const scoped = {
      from: () => ({
        select: () => ({
          eq: (column: string, value: string) => ({
            eq: (col2: string, val2: string) => ({
              maybeSingle: async () => {
                const match =
                  (client.store.batches[0]![column] as string) === value &&
                  (client.store.batches[0]![col2] as string) === val2;
                return { data: match ? client.store.batches[0] : null, error: null };
              },
            }),
          }),
        }),
      }),
    };
    await expect(loadBatchPreview(scoped as never, OTHER, batchId)).resolves.toBeNull();
  });
});

describe("synthetic CRM fidelity fixture", () => {
  const FIXTURE =
    "Name,Email,Phone,Source,Form,Stage,Created,Owner,Labels,Unknown Test Column\n" +
    "Synthetic Valid Lead,synthetic.valid@example.com,+61499999999,CRM,Test Form,New,2026-08-30,Test Owner,test,keep-me\n" +
    'Empty Phone Lead,empty.phone@example.com,,Lead Source Value,Test Form,New,2026-08-30,Test Owner,test,"quoted, value"\n' +
    "Malformed Lead,malformed@example.com,+61499999998,CRM,Test Form\n";

  it("maps source, form, stage, created, owner, labels and keeps unknown columns", () => {
    const table = parseCsv(FIXTURE);
    expect(unmappedColumns(table.headers)).toEqual(["Unknown Test Column"]);
    const row = prepareRow(table.headers, table.rows[0]!, 1);
    const p = row.normalized_payload;
    expect(p.name).toBe("Synthetic Valid Lead");
    expect(p.email).toBe("synthetic.valid@example.com");
    expect(p.mobile_number).toBe("+61499999999");
    expect(p.source_channel_raw).toBe("CRM");
    expect(p.source_channel).toBe("manual");
    expect(p.source_form).toBe("Test Form");
    expect(p.proposed_status).toBe("previous_lead");
    expect(p.proposed_created_at).toContain("2026-08-30");
    expect(p.source_metadata).toEqual({
      owner: "Test Owner",
      labels: "test",
      created_at_raw: "2026-08-30",
      stage_raw: "New",
      phone_raw: "+61499999999",
    });

    expect(row.raw_row["Unknown Test Column"]).toBe("keep-me");
    expect(row.validation_errors).toEqual([]);
  });

  it("maps the alternate source and form header spellings", () => {
    const table = parseCsv(
      "Name,Phone,Lead Source,Lead Form\nAda,0412345678,Channel Partner,Winter Form",
    );
    expect(unmappedColumns(table.headers)).toEqual([]);
    const p = prepareRow(table.headers, table.rows[0]!, 1).normalized_payload;
    expect(p.source_channel_raw).toBe("Channel Partner");
    expect(p.source_form).toBe("Winter Form");
    const table2 = parseCsv("Name,Phone,Source Channel,Campaign Form\nAda,0412345678,CRM,Autumn");
    expect(unmappedColumns(table2.headers)).toEqual([]);
    const p2 = prepareRow(table2.headers, table2.rows[0]!, 1).normalized_payload;
    expect(p2.source_channel_raw).toBe("CRM");
    expect(p2.source_channel).toBe("manual");
    expect(p2.source_form).toBe("Autumn");
  });

  it("does not shift columns when a quoted row has an empty phone", () => {
    const table = parseCsv(FIXTURE);
    const row = prepareRow(table.headers, table.rows[1]!, 2);
    const p = row.normalized_payload;
    expect(p.mobile_number).toBeNull();
    expect(p.email).toBe("empty.phone@example.com");
    expect(p.source_channel_raw).toBe("Lead Source Value");
    expect(p.source_form).toBe("Test Form");
    expect(p.proposed_status).toBe("previous_lead");
    expect(row.raw_row["Unknown Test Column"]).toBe("quoted, value");
    expect(row.validation_errors.map((e) => e.code)).not.toContain("malformed_row");
  });

  it("flags a row with the wrong field count as malformed", () => {
    const table = parseCsv(FIXTURE);
    const row = prepareRow(table.headers, table.rows[2]!, 3);
    const malformed = row.validation_errors.find((e) => e.code === "malformed_row");
    expect(malformed?.detail).toBe("expected 10 fields, found 5");
    expect(row.normalized_payload.source_channel_raw).toBe("CRM");
    expect(row.normalized_payload.proposed_created_at).toBeNull();
  });
});

describe("real Meta lead-ads CRM export mapping", () => {
  const HEADERS = [
    "full_name",
    "email",
    "phone_number",
    "created_time",
    "platform",
    "is_organic",
    "form_name",
    "id",
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "form_id",
    "what_services_are_you_seeking_for_your_vehicle?",
    "what_do_you_primarily_use_your_vehicle_for?",
    "what_type_of_vehicle_do_you_have?_(include_year/make/model_if_possible)",
  ];
  const row = (cells: string[]) => {
    const csv = [HEADERS.join(","), cells.join(",")].join("\n");
    const table = parseCsv(csv);
    return prepareRow(table.headers, table.rows[0]!, 1);
  };
  const BASE = [
    "Jane Citizen",
    "jane@example.com",
    "0412 345 678",
    "1/13/26",
    "fb",
    "true",
    "Quote form",
    "lead-1",
    "ad-1",
    "Summer Ad",
    "adset-1",
    "Sydney Adset",
    "camp-1",
    "Winter Campaign",
    "form-1",
    "Ceramic coating",
    '"Home, office, travel"',
    "2021 Toyota Hilux",
  ];

  it("maps full_name, email, phone_number and form_name", () => {
    const prepared = row(BASE);
    const p = prepared.normalized_payload;
    expect(p.name).toBe("Jane Citizen");
    expect(p.email).toBe("jane@example.com");
    expect(p.mobile_number).toBe("+61412345678");
    expect(p.source_form).toBe("Quote form");
    expect(p.proposed_status).toBeNull();
  });

  it("parses US-style M/D/YY created_time values", () => {
    expect(parseCreatedAt("1/13/26")).toContain("2026-01-13");
    expect(parseCreatedAt("1/11/26")).toContain("2026-01-11");
    expect(parseCreatedAt("12/5/25")).toContain("2025-12-05");
    expect(parseCreatedAt("12/1/25")).toContain("2025-12-01");
    expect(parseCreatedAt("11/14/25")).toContain("2025-11-14");
  });

  it("exposes the parsed date and preserves the raw created_time value", () => {
    const prepared = row(BASE);
    expect(prepared.normalized_payload.proposed_created_at).toContain("2026-01-13");
    expect(prepared.normalized_payload.source_metadata["created_time_raw"]).toBe("1/13/26");
  });

  it("normalizes fb/ig platforms and preserves the raw value", () => {
    expect(normalizePlatform("fb")).toBe("facebook");
    expect(normalizePlatform("ig")).toBe("instagram");
    const fbRow = row(BASE);
    expect(fbRow.normalized_payload.source_metadata["platform"]).toBe("facebook");
    expect(fbRow.normalized_payload.source_metadata["platform_raw"]).toBe("fb");
    expect(fbRow.normalized_payload.source_channel).toBe("meta");
    expect(fbRow.normalized_payload.source_channel_raw).toBe("fb");
    const igRow = row(BASE.map((c, i) => (i === 4 ? "ig" : c)));
    expect(igRow.normalized_payload.source_metadata["platform"]).toBe("instagram");
    expect(igRow.normalized_payload.source_metadata["platform_raw"]).toBe("ig");
  });

  it("preserves is_organic as a boolean string without changing its meaning", () => {
    expect(row(BASE).normalized_payload.source_metadata["is_organic"]).toBe("true");
    expect(
      row(BASE.map((c, i) => (i === 5 ? "false" : c))).normalized_payload.source_metadata[
        "is_organic"
      ],
    ).toBe("false");
  });

  it("preserves campaign, ad, adset, form, service, vehicle-use and vehicle fields as raw/unmapped data", () => {
    const prepared = row(BASE);
    expect(prepared.raw_row["campaign_name"]).toBe("Winter Campaign");
    expect(prepared.raw_row["campaign_id"]).toBe("camp-1");
    expect(prepared.raw_row["ad_id"]).toBe("ad-1");
    expect(prepared.raw_row["ad_name"]).toBe("Summer Ad");
    expect(prepared.raw_row["adset_id"]).toBe("adset-1");
    expect(prepared.raw_row["adset_name"]).toBe("Sydney Adset");
    expect(prepared.raw_row["form_id"]).toBe("form-1");
    expect(prepared.raw_row["id"]).toBe("lead-1");
    expect(prepared.raw_row["what_services_are_you_seeking_for_your_vehicle?"]).toBe(
      "Ceramic coating",
    );
    expect(prepared.raw_row["what_do_you_primarily_use_your_vehicle_for?"]).toBe(
      "Home, office, travel",
    );
    expect(
      prepared.raw_row["what_type_of_vehicle_do_you_have?_(include_year/make/model_if_possible)"],
    ).toBe("2021 Toyota Hilux");
    expect(prepared.normalized_payload.unmapped_columns).toEqual(
      expect.arrayContaining([
        "id",
        "ad_id",
        "ad_name",
        "adset_id",
        "adset_name",
        "campaign_id",
        "campaign_name",
        "form_id",
        "what_services_are_you_seeking_for_your_vehicle?",
        "what_do_you_primarily_use_your_vehicle_for?",
        "what_type_of_vehicle_do_you_have?_(include_year/make/model_if_possible)",
      ]),
    );
  });

  it("keeps comma-containing quoted values intact", () => {
    const prepared = row(BASE);
    expect(prepared.validation_errors.map((e) => e.code)).not.toContain("malformed_row");
    expect(prepared.raw_row["what_do_you_primarily_use_your_vehicle_for?"]).toBe(
      "Home, office, travel",
    );
  });

  it("keeps the non-mobile error for an Australian landline and keeps the row usable", () => {
    const landline = row(BASE.map((c, i) => (i === 2 ? "+61247869523" : c)));
    const p = landline.normalized_payload;
    expect(landline.validation_errors).toContainEqual({
      code: "unsupported_phone_type",
      field: "mobile_number",
      detail: "+61247869523",
    });
    expect(p.mobile_number).toBeNull();
    expect(p.name).toBe("Jane Citizen");
    expect(p.email).toBe("jane@example.com");
    expect(p.source_metadata["platform"]).toBe("facebook");
    expect(landline.raw_row["campaign_name"]).toBe("Winter Campaign");
  });

  it("keeps invalid phone errors unchanged", () => {
    const bad = row(BASE.map((c, i) => (i === 2 ? "not-a-phone" : c)));
    expect(bad.validation_errors).toContainEqual({
      code: "invalid_phone",
      field: "mobile_number",
      detail: "not-a-phone",
    });
    expect(bad.normalized_payload.mobile_number).toBeNull();
  });

  it("does not reject test@com.au solely because it looks suspicious", () => {
    const prepared = row(BASE.map((c, i) => (i === 1 ? "test@com.au" : c)));
    expect(prepared.normalized_payload.email).toBe("test@com.au");
    expect(prepared.validation_errors.map((e) => e.code)).not.toContain("invalid_email");
  });

  it("keeps all decisions pending and performs no live writes or provider calls", async () => {
    const csv = [HEADERS.join(","), BASE.join(","), BASE.join(","), BASE.join(",")].join("\n");
    const client = fakeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await previewCrmCsv(client as never, {
      businessId: GLOCAST,
      userId: OWNER,
      filename: "meta-export.csv",
      content: csv,
    });
    expect(result.rows.every((r) => r.decision === "pending")).toBe(true);
    expect([...new Set(client.writes.map((w) => w.table))].sort()).toEqual([
      "import_batches",
      "lead_import_rows",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("delimiter sniffing, dates and header aliases (CRM export fix)", () => {
  const HEADER = [
    "Created",
    "Name",
    "Email",
    "Source",
    "Form",
    "Channel",
    "Stage",
    "Owner",
    "Labels",
    "Phone",
    "Secondary phone number",
    "WhatsApp number",
  ];
  const ROW = [
    "08/29/2026 5:27 AM",
    "Diana Borinski",
    "dianaborinski@gmail.com",
    "Paid",
    "Glocast-copy",
    "Email",
    "Intake",
    "Unassigned",
    "",
    "+61423662012",
    "0412 345 678",
    "+61423662012",
  ];

  it("detects a tab delimiter and maps every header", () => {
    const text = `${HEADER.join("\t")}\n${ROW.join("\t")}\t\t\t\n`;
    expect(detectDelimiter(text)).toBe("\t");
    const table = parseCsv(text);
    expect(table.headers).toEqual(HEADER);
    expect(table.headers.length).toBe(12);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toHaveLength(12);

    const prepared = prepareRow(table.headers, table.rows[0]!, 1);
    // "Intake" maps to the internal `new` status; every other field maps cleanly.
    expect(prepared.validation_errors).toEqual([]);
    expect(prepared.normalized_payload.proposed_status).toBe("previous_lead");
    expect(prepared.normalized_payload.source_metadata["stage_raw"]).toBe("Intake");
    expect(prepared.normalized_payload.name).toBe("Diana Borinski");
    expect(prepared.normalized_payload.mobile_number).toBe("+61423662012");
    expect(prepared.normalized_payload.email).toBe("dianaborinski@gmail.com");
    expect(prepared.normalized_payload.source_channel_raw).toBe("Paid");
    expect(prepared.normalized_payload.source_form).toBe("Glocast-copy");
    expect(prepared.normalized_payload.proposed_created_at).toBe("2026-08-29T05:27:00.000Z");
    expect(prepared.normalized_payload.source_metadata["channel"]).toBe("Email");
    expect(prepared.normalized_payload.source_metadata["owner"]).toBe("Unassigned");
    expect(prepared.normalized_payload.source_metadata["secondary_phone"]).toBe("0412 345 678");
    expect(prepared.normalized_payload.source_metadata["whatsapp_number"]).toBe("+61423662012");
    expect(prepared.normalized_payload.source_metadata["created_at_raw"]).toBe("08/29/2026 5:27 AM");
    expect(prepared.normalized_payload.unmapped_columns).toEqual([]);
  });

  it("keeps comma files working and defaults to comma", () => {
    const text = `${HEADER.join(",")}\n${ROW.join(",")}`;
    expect(detectDelimiter(text)).toBe(",");
    const table = parseCsv(text);
    expect(table.headers).toEqual(HEADER);
    expect(prepareRow(table.headers, table.rows[0]!, 1).validation_errors).toEqual([]);
  });

  it("detects semicolon files", () => {
    const text = "Name;Phone;Email\nAda;0412345678;ada@example.com";
    expect(detectDelimiter(text)).toBe(";");
    const table = parseCsv(text);
    expect(table.headers).toEqual(["Name", "Phone", "Email"]);
    expect(table.rows[0]).toEqual(["Ada", "0412345678", "ada@example.com"]);
  });

  it("does not split delimiters inside quoted values", () => {
    const comma = parseCsv('Name,Labels\n"Ada, Jr","vip,hot"');
    expect(comma.rows[0]).toEqual(["Ada, Jr", "vip,hot"]);
    const tab = parseCsv('Name\tLabels\n"Ada\tJr"\tvip');
    expect(tab.rows[0]).toEqual(["Ada\tJr", "vip"]);
    const multiline = parseCsv('Name,Notes\nAda,"line1\nline2"');
    expect(multiline.rows[0]).toEqual(["Ada", "line1\nline2"]);
  });

  it("strips a UTF-8 BOM for both delimiters", () => {
    expect(parseCsv("\uFEFFName,Phone\nAda,0412345678").headers).toEqual(["Name", "Phone"]);
    expect(parseCsv("\uFEFFName\tPhone\nAda\t0412345678").headers).toEqual(["Name", "Phone"]);
  });

  it("parses MM/DD/YYYY h:mm AM/PM deterministically and keeps older formats", () => {
    expect(parseCreatedAt("08/29/2026 5:27 AM")).toBe("2026-08-29T05:27:00.000Z");
    expect(parseCreatedAt("08/29/2026 5:27 PM")).toBe("2026-08-29T17:27:00.000Z");
    expect(parseCreatedAt("08/29/2026 12:05 AM")).toBe("2026-08-29T00:05:00.000Z");
    expect(parseCreatedAt("08/29/2026 12:05 PM")).toBe("2026-08-29T12:05:00.000Z");
    expect(parseCreatedAt("3/4/2026")).toBe(new Date("2026-04-03").toISOString());
    expect(parseCreatedAt("3/4/26")).toBe(new Date("2026-03-04").toISOString());
    expect(parseCreatedAt("")).toBeNull();
    expect(parseCreatedAt("not a date")).toBeNull();
  });

  it("maps 'Secondary phone number' and validates AU mobiles", () => {
    expect(canonicalField("Secondary phone number")).toBe("secondary_phone");
    expect(canonicalField("Channel")).toBe("channel");
    expect(canonicalField("Source")).toBe("source_channel");
    expect(canonicalField("Form")).toBe("source_form");
    expect(canonicalField("Stage")).toBe("status");
    expect(canonicalField("Owner")).toBe("owner");
    expect(canonicalField("Labels")).toBe("labels");
    expect(canonicalField("Created")).toBe("created_at");
    expect(classifyAuPhone("+61 423 662 012")).toEqual({ kind: "mobile", value: "+61423662012" });
    expect(classifyAuPhone("0423662012")).toEqual({ kind: "mobile", value: "+61423662012" });
  });

  it("parses a 253-row tab-separated export with zero issues", () => {
    const lines = [HEADER.join("\t")];
    for (let i = 0; i < 253; i += 1) {
      const row = [...ROW];
      row[1] = `Person ${i}`;
      row[2] = `person${i}@example.com`;
      row[9] = `+6142300${String(i).padStart(4, "0")}`;
      lines.push(`${row.join("\t")}\t\t\t`);
    }
    const table = parseCsv(lines.join("\r\n"));
    expect(table.rows).toHaveLength(253);
    const prepared = flagInBatchDuplicates(
      table.rows.map((row, index) => prepareRow(table.headers, row, index + 1)),
    );
    // No issues at all now that "Intake" maps to `new`.
    expect(prepared.filter((row) => row.validation_errors.length > 0)).toHaveLength(0);
    expect(prepared.filter((row) => row.duplicate_of_row !== null)).toHaveLength(0);
  });
});

describe("restageStage (preview-only stage remap)", () => {
  it("clears a stale unmappable_stage issue once the stage maps", () => {
    const out = restageStage("Intake", [
      { code: "unmappable_stage", field: "status", detail: "Intake" },
    ]);
    expect(out.status).toBe("previous_lead");
    expect(out.stage_raw).toBe("Intake");
    expect(out.errors).toEqual([]);
    expect(out.changed).toBe(true);
  });

  it("maps Converted without touching other issues", () => {
    const out = restageStage("Converted", [
      { code: "missing_name", field: "name" },
      { code: "unmappable_stage", field: "status", detail: "Converted" },
    ]);
    expect(out.status).toBe("completed");
    expect(out.errors).toEqual([{ code: "missing_name", field: "name" }]);
  });

  it("keeps unknown stages as exceptions", () => {
    const errors = [{ code: "unmappable_stage", field: "status", detail: "Nurture" }];
    const out = restageStage("Nurture", errors);
    expect(out.status).toBeNull();
    expect(out.errors).toBe(errors);
    expect(out.changed).toBe(false);
  });

  it("is a no-op when no stage was supplied", () => {
    const out = restageStage("", []);
    expect(out.status).toBeNull();
    expect(out.stage_raw).toBeNull();
    expect(out.changed).toBe(false);
  });
});
