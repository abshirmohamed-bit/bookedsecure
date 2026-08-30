import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";
import { editStagedRow } from "@/lib/csv-import.server";
import {
  applyStagedEdit,
  canEditStagedRow,
  diffEditableValues,
  exceptionLabel,
  isCreatedDateEditable,
  maskContact,
  normalizeEditableValues,
  readEditableValues,
  readOriginalValues,
  resolveStagedRowState,
  StagedEditError,
} from "@/lib/staged-row-edit";
import { prepareRow, parseCsv } from "@/lib/csv-import";

const BUSINESS = "biz-1";
const OTHER_BUSINESS = "biz-2";
const BATCH = "batch-1";
const USER = "user-1";

function values(overrides: Record<string, string> = {}) {
  return {
    name: "",
    email: "",
    phone: "",
    secondary_phone: "",
    whatsapp_number: "",
    status: "",
    source: "",
    form: "",
    channel: "",
    owner: "",
    labels: "",
    created_at: "",
    ...overrides,
  } as ReturnType<typeof readEditableValues>;
}

function stagedRow(payload: Record<string, unknown>, errors: { code: string }[] = []) {
  return {
    id: "row-1",
    batch_id: BATCH,
    business_id: BUSINESS,
    row_number: 1,
    raw_row: { Name: "Original", Phone: "+610404398423", Email: "orig@example.com", Stage: "Intake" },
    normalized_payload: payload,
    validation_errors: errors,
    dedupe_match_lead_id: null,
    decision: "pending",
  };
}

function db(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    import_batches: [{ id: BATCH, business_id: BUSINESS, status: "previewed" }],
    lead_import_rows: [],
    leads: [],
    audit_events: [],
    ...overrides,
  };
}

const BASE_PAYLOAD = {
  name: null,
  email: "orig@example.com",
  email_normalised: "orig@example.com",
  mobile_number: null,
  source_channel: "manual",
  source_channel_raw: "CRM import",
  source_form: "Quote form",
  proposed_status: null,
  proposed_created_at: null,
  source_metadata: { stage_raw: "Intake", owner: "Harry" },
  unmapped_columns: [],
  duplicate_of_row: null,
};

// --- pure normalization -------------------------------------------------------

describe("phone normalization uses the shared AU classifier", () => {
  const formats = [
    "0404398423",
    "0404 398 423",
    "+61404398423",
    "+61 404 398 423",
  ];
  for (const input of formats) {
    it(`normalizes ${input}`, () => {
      expect(normalizeEditableValues(values({ name: "A", phone: input })).mobile_number).toBe(
        "+61404398423",
      );
    });
  }

  it("classifies a landline as a non-mobile phone, not malformed data", () => {
    const result = normalizeEditableValues(values({ name: "A", phone: "0299998888" }));
    expect(result.mobile_number).toBeNull();
    expect(result.errors.map((e) => e.code)).toContain("unsupported_phone_type");
    expect(exceptionLabel("unsupported_phone_type")).toBe("Non-mobile phone");
  });

  it("keeps a genuinely malformed phone as invalid_phone", () => {
    const result = normalizeEditableValues(values({ name: "A", phone: "12345" }));
    expect(result.errors.map((e) => e.code)).toContain("invalid_phone");
    expect(exceptionLabel("invalid_phone")).toBe("Invalid phone");
  });

  it("reports missing name and missing contact details", () => {
    const result = normalizeEditableValues(values());
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("missing_name");
    expect(codes).toContain("missing_phone_and_email");
  });

  it("maps an edited stage and flags an unknown one", () => {
    expect(normalizeEditableValues(values({ status: "scheduled" })).proposed_status).toBe(
      "scheduled",
    );
    expect(
      normalizeEditableValues(values({ status: "Mystery" })).errors.map((e) => e.code),
    ).toContain("unmappable_stage");
  });
});

describe("applyStagedEdit preserves protected data", () => {
  it("keeps the raw stage and raw source while storing the correction", () => {
    const result = applyStagedEdit(BASE_PAYLOAD, { status: "completed", source: "Website" }, {
      userId: USER,
    });
    const meta = result.payload.source_metadata as Record<string, string>;
    expect(meta["stage_raw"]).toBe("Intake");
    expect(meta["stage_corrected"]).toBe("completed");
    expect(result.payload.source_channel_raw).toBe("CRM import");
    expect(result.payload.source_channel).toBe("website");
  });

  it("snapshots the original parsed values once and never overwrites them", () => {
    const first = applyStagedEdit(BASE_PAYLOAD, { name: "Harry" }, { userId: USER });
    const second = applyStagedEdit(first.payload, { name: "Harold" }, { userId: USER });
    expect(readOriginalValues(second.payload).name).toBe("");
    expect(readEditableValues(second.payload).name).toBe("Harold");
    expect(second.payload.edits?.revision).toBe(2);
  });

  it("records only the changed fields", () => {
    const result = applyStagedEdit(BASE_PAYLOAD, { name: "Harry", form: "Quote form" }, {
      userId: USER,
    });
    expect(result.changes.map((c) => c.field)).toEqual(["name"]);
  });

  it("refuses to edit a created date that is already valid", () => {
    expect(() =>
      applyStagedEdit(
        { ...BASE_PAYLOAD, proposed_created_at: "2026-01-01T00:00:00.000Z" },
        { created_at: "01/02/2026" },
        { userId: USER },
      ),
    ).toThrow(StagedEditError);
    expect(isCreatedDateEditable({ ...BASE_PAYLOAD, proposed_created_at: null })).toBe(true);
  });

  it("diffs and masks safely", () => {
    expect(diffEditableValues(values({ name: "A" }), values({ name: "B" }))).toEqual([
      { field: "name", from: "A", to: "B" },
    ]);
    expect(maskContact("+61404398423")).toMatch(/423$/);
    expect(maskContact("harry@example.com")).toBe("h••••@example.com");
  });
});

describe("resolveStagedRowState returns exactly one state", () => {
  const base = { validation_errors: [] as { code: string }[] };
  it("already committed wins", () => {
    expect(resolveStagedRowState({ ...base, commit_status: "committed" })).toBe("already_committed");
    expect(canEditStagedRow({ commit_status: "committed" })).toBe(false);
  });
  it("excluded, duplicate, invalid, auto-include and pending", () => {
    expect(resolveStagedRowState({ ...base, review_decision: "exclude" })).toBe("excluded");
    expect(resolveStagedRowState({ ...base, dedupe_match_lead_id: "lead-1" })).toBe(
      "potential_duplicate",
    );
    expect(resolveStagedRowState({ ...base, duplicate_of_row: 4 })).toBe("potential_duplicate");
    expect(resolveStagedRowState({ validation_errors: [{ code: "invalid_phone" }] })).toBe(
      "invalid_contact",
    );
    expect(
      resolveStagedRowState({
        ...base,
        classification: "auto_include",
        review_decision: "include",
      }),
    ).toBe("auto_include_candidate");
    expect(resolveStagedRowState({ validation_errors: [{ code: "missing_name" }] })).toBe(
      "pending_review",
    );
  });
});

// --- server editing -----------------------------------------------------------

describe("editStagedRow (preview-only)", () => {
  const LIVE_TABLES = ["conversations", "messages", "jobs", "notifications", "automation_jobs"];

  function assertNoSideEffects(client: { writes: { table: string; op: string }[] }) {
    for (const table of [...LIVE_TABLES, "leads"]) {
      expect(client.writes.filter((w) => w.table === table && w.op !== "select")).toEqual([]);
    }
  }

  it("repairs a +610... phone, reclassifies the row and preserves the raw row", async () => {
    const data = db({
      lead_import_rows: [
        stagedRow({ ...BASE_PAYLOAD, name: "Harry" }, [
          { code: "invalid_phone" },
          { code: "missing_phone_and_email" },
        ]),
      ],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "+610404398423" },
    });
    expect(result.row.mobile_number).toBe("+61404398423");
    expect(result.row.validation_errors).toEqual([]);
    expect(result.state).toBe("auto_include_candidate");
    expect(result.changed_fields).toEqual(["phone"]);
    expect(data.lead_import_rows[0]!.raw_row).toEqual({
      Name: "Original",
      Phone: "+610404398423",
      Email: "orig@example.com",
      Stage: "Intake",
    });
    expect(data.audit_events).toHaveLength(1);
    expect(data.audit_events[0]!.event_type).toBe("import_row_edited");
    assertNoSideEffects(client);
  });

  it("accepts a spaced AU mobile and stores the corrected raw phone", async () => {
    const data = db({ lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })] });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "+61 0404 398 423" },
    });
    expect(result.row.mobile_number).toBe("+61404398423");
    const meta = data.lead_import_rows[0]!.normalized_payload.source_metadata;
    expect(meta.phone_corrected).toBe("+61 0404 398 423");
    expect(meta.stage_raw).toBe("Intake");
  });

  it("saving a name keeps a still-missing phone pending", async () => {
    const data = db({
      lead_import_rows: [stagedRow({ ...BASE_PAYLOAD }, [{ code: "missing_name" }])],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { name: "Harry" },
    });
    expect(result.state).toBe("invalid_contact");
    expect(result.row.review.decision).toBe("pending");
  });

  it("a cleared name puts the row back to pending review", async () => {
    const data = db({
      lead_import_rows: [
        stagedRow({ ...BASE_PAYLOAD, name: "Harry", mobile_number: "+61404398423" }),
      ],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { name: "" },
    });
    expect(result.row.validation_errors.map((e) => e.code)).toContain("missing_name");
    expect(result.state).toBe("pending_review");
    expect(result.row.review.decision).toBe("pending");
  });

  it("edits an email and revalidates it", async () => {
    const data = db({ lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })] });
    const client = createFakeSupabase(data);
    const bad = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { email: "not-an-email" },
    });
    expect(bad.row.validation_errors.map((e) => e.code)).toContain("invalid_email");
    const good = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { email: "harry@example.com", phone: "0404398423" },
    });
    expect(good.row.email).toBe("harry@example.com");
    expect(good.state).toBe("auto_include_candidate");
  });

  it("detects an existing-lead duplicate after editing the phone", async () => {
    const data = db({
      lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })],
      leads: [
        {
          id: "lead-9",
          business_id: BUSINESS,
          mobile_number: "+61404398423",
          email_normalised: null,
          email: null,
        },
      ],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "0404398423" },
    });
    expect(result.duplicate.existing_lead_id).toBe("lead-9");
    expect(result.state).toBe("potential_duplicate");
    expect(result.row.review.decision).toBe("pending");
    expect(data.leads).toHaveLength(1);
  });

  it("detects an existing-lead duplicate after editing the email", async () => {
    const data = db({
      lead_import_rows: [
        stagedRow({ ...BASE_PAYLOAD, name: "Harry", mobile_number: "+61411111111" }),
      ],
      leads: [
        {
          id: "lead-8",
          business_id: BUSINESS,
          mobile_number: null,
          email_normalised: "dupe@example.com",
          email: "dupe@example.com",
        },
      ],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { email: "Dupe@example.com" },
    });
    expect(result.duplicate.existing_lead_id).toBe("lead-8");
    expect(result.row.validation_errors.map((e) => e.code)).toContain("duplicate_existing_email");
  });

  it("detects an in-batch duplicate after editing", async () => {
    const data = db({
      lead_import_rows: [
        stagedRow({ ...BASE_PAYLOAD, name: "Harry" }),
        {
          ...stagedRow({ ...BASE_PAYLOAD, name: "Other", mobile_number: "+61422222222" }),
          id: "row-2",
          row_number: 2,
        },
      ],
    });
    const client = createFakeSupabase(data);
    const result = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "0422222222" },
    });
    expect(result.duplicate.in_batch_row).toBe(2);
    expect(result.state).toBe("potential_duplicate");
  });

  it("is idempotent when the same save runs twice", async () => {
    const data = db({ lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })] });
    const client = createFakeSupabase(data);
    const first = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "0404398423" },
    });
    const second = await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { phone: "0404398423" },
    });
    expect(second.changed_fields).toEqual([]);
    expect(second.row.mobile_number).toBe(first.row.mobile_number);
    expect(data.audit_events).toHaveLength(1);
    expect(data.lead_import_rows).toHaveLength(1);
  });

  it("a failed save leaves the staged values unchanged", async () => {
    const data = db({
      lead_import_rows: [
        stagedRow({ ...BASE_PAYLOAD, name: "Harry", proposed_created_at: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    const client = createFakeSupabase(data);
    await expect(
      editStagedRow(client, BUSINESS, {
        batchId: BATCH,
        rowNumber: 1,
        userId: USER,
        fields: { created_at: "bogus" },
      }),
    ).rejects.toThrow(StagedEditError);
    expect(data.lead_import_rows[0]!.normalized_payload.name).toBe("Harry");
    expect(data.audit_events).toHaveLength(0);
  });

  it("is tenant isolated", async () => {
    const data = db({ lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })] });
    const client = createFakeSupabase(data);
    await expect(
      editStagedRow(client, OTHER_BUSINESS, {
        batchId: BATCH,
        rowNumber: 1,
        userId: "intruder",
        fields: { name: "Hacked" },
      }),
    ).rejects.toThrow(/not found/i);
    expect(data.lead_import_rows[0]!.normalized_payload.name).toBe("Harry");
  });

  it("refuses to edit a committed row or a committed batch", async () => {
    const committedRow = db({
      lead_import_rows: [
        stagedRow({
          ...BASE_PAYLOAD,
          name: "Harry",
          commit: { status: "committed", lead_id: "lead-1", idempotency_key: "k" },
        }),
      ],
    });
    await expect(
      editStagedRow(createFakeSupabase(committedRow), BUSINESS, {
        batchId: BATCH,
        rowNumber: 1,
        userId: USER,
        fields: { name: "Nope" },
      }),
    ).rejects.toThrow(/already been committed/);

    const committedBatch = db({
      import_batches: [{ id: BATCH, business_id: BUSINESS, status: "committed" }],
      lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })],
    });
    await expect(
      editStagedRow(createFakeSupabase(committedBatch), BUSINESS, {
        batchId: BATCH,
        rowNumber: 1,
        userId: USER,
        fields: { name: "Nope" },
      }),
    ).rejects.toThrow(/already been committed/);
  });

  it("leaves existing GoDaddy leads untouched while editing", async () => {
    const godaddy = {
      id: "lead-godaddy",
      business_id: BUSINESS,
      mobile_number: "+61433333333",
      email: "g@example.com",
      email_normalised: "g@example.com",
      source_channel: "godaddy",
    };
    const data = db({
      lead_import_rows: [stagedRow({ ...BASE_PAYLOAD, name: "Harry" })],
      leads: [godaddy],
    });
    const client = createFakeSupabase(data);
    await editStagedRow(client, BUSINESS, {
      batchId: BATCH,
      rowNumber: 1,
      userId: USER,
      fields: { name: "Harry Fixed" },
    });
    expect(data.leads[0]).toEqual(godaddy);
    assertNoSideEffects(client);
  });

  it("reprocessing an upload row keeps the parsed identity stable", () => {
    const table = parseCsv("Name,Phone,Email,Stage\nHarry,+610404398423,h@example.com,Intake");
    const prepared = prepareRow(table.headers, table.rows[0]!, 1);
    expect(prepared.normalized_payload.source_metadata["stage_raw"]).toBe("Intake");
    const edited = applyStagedEdit(prepared.normalized_payload, { phone: "0404398423" }, {
      userId: USER,
    });
    expect(edited.payload.mobile_number).toBe("+61404398423");
    expect(edited.payload.source_metadata!["stage_raw"]).toBe("Intake");
  });
});
