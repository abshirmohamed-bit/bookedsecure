import { describe, expect, it, vi } from "vitest";
import {
  classifyAuPhone,
  mapStage,
  parseCsv,
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
    expect(p.proposed_status).toBe("new");
    expect(p.proposed_created_at).toContain("2026-08-30");
    expect(p.source_metadata).toEqual({ owner: "Test Owner", labels: "test" });
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
    expect(p.proposed_status).toBe("new");
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
