import { describe, expect, it } from "vitest";
import { buildImportLeadInsert, IMPORT_LEAD_ORIGIN } from "@/lib/import-lead.server";
import { composeInboxRows, inboxLastActivity } from "@/lib/lead-inbox";
import { commitIdempotencyKey } from "@/lib/commit-gate";
import { LEAD_ORIGINS, isAllowedLeadOrigin } from "@/lib/domain";


const BATCH = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const payload = {
  name: "Harry Wilson",
  mobile_number: "+61412345678",
  email: "harry@example.com",
  email_normalised: "harry@example.com",
  source_channel: "facebook",
  source_channel_raw: "fb",
  source_form: "Detailing enquiry",
  proposed_created_at: "2025-07-14T03:00:00.000Z",
  source_metadata: {
    platform: "fb",
    form_name: "Detailing enquiry",
    suburb: "Bondi",
    vehicle_type: "SUV",
    service_intent: "Full interior detail",
    campaign_name: "Winter promo",
  },
};

function insertFor(overrides: Record<string, unknown> = {}) {
  return buildImportLeadInsert({
    businessId: TENANT,
    batchId: BATCH,
    rowNumber: 3,
    idempotencyKey: commitIdempotencyKey(BATCH, 3),
    payload: { ...payload, ...overrides },
    rawRow: { Name: "Harry Wilson", Phone: "0412 345 678" },
  });
}

describe("import-only lead insert", () => {
  it("maps name, phone, email, source and form", () => {
    const insert = insertFor();
    expect(insert.name).toBe("Harry Wilson");
    expect(insert.mobile_number).toBe("+61412345678");
    expect(insert.email).toBe("harry@example.com");
    expect(insert.email_normalised).toBe("harry@example.com");
    expect(insert.source_channel).toBe("facebook");
    expect(insert.source_form).toBe("Detailing enquiry");
    expect(insert.source_campaign).toBe("Winter promo");
    expect(insert.business_id).toBe(TENANT);
  });

  it("maps suburb, vehicle and service interest where available", () => {
    const insert = insertFor();
    expect(insert.suburb).toBe("Bondi");
    expect(insert.vehicle_type).toBe("SUV");
    expect(insert.service_intent).toBe("Full interior detail");
  });

  it("preserves the original values plus import provenance in source metadata", () => {
    const insert = insertFor();
    expect(insert.source_metadata["platform"]).toBe("fb");
    const info = insert.source_metadata["import"] as Record<string, unknown>;
    expect(info["origin"]).toBe(IMPORT_LEAD_ORIGIN);
    expect(info["batch_id"]).toBe(BATCH);
    expect(info["row_number"]).toBe(3);
    expect(info["source_channel_raw"]).toBe("fb");
    expect(info["raw_row"]).toEqual({ Name: "Harry Wilson", Phone: "0412 345 678" });
  });

  it("marks the lead as imported and carries the deterministic idempotency key", () => {
    const insert = insertFor();
    expect(insert.lead_origin).toBe(IMPORT_LEAD_ORIGIN);
    expect(insert.external_id).toBe(`crm-import:${BATCH}:row:3`);
    expect(insert.import_batch_id).toBe(BATCH);
  });

  it("creates no conversation, message, job, automation or pipeline fields", () => {
    const keys = Object.keys(insertFor());
    for (const forbidden of [
      "conversation_id",
      "conversation",
      "messages",
      "job",
      "automation",
      "follow_up_step",
      "next_follow_up_at",
      "first_contacted_at",
      "first_reply_at",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("defaults to a safe status and never invents readiness", () => {
    expect(insertFor().status).toBe("new");
    expect(insertFor({ proposed_status: "not_a_status" }).status).toBe("new");
    expect(insertFor({ proposed_status: "completed" }).status).toBe("completed");
    expect(insertFor().readiness_classification).toBeNull();
  });

  it("tolerates missing optional fields", () => {
    const insert = buildImportLeadInsert({
      businessId: TENANT,
      batchId: BATCH,
      rowNumber: 1,
      idempotencyKey: commitIdempotencyKey(BATCH, 1),
      payload: { name: null, mobile_number: "+61400000000", email: null, email_normalised: null },
    });
    expect(insert.name).toBe("Imported lead");
    expect(insert.email).toBeNull();
    expect(insert.suburb).toBeNull();
    expect(insert.source_channel).toBe("unknown");
  });
});

describe("lead inbox composition", () => {
  const imported = { id: "lead-imported", created_at: "2025-07-14T03:00:00.000Z" };
  const inbound = { id: "lead-inbound", created_at: "2025-07-15T03:00:00.000Z" };

  it("shows an imported lead that has no conversation", () => {
    const rows = composeInboxRows(
      [imported, inbound],
      [{ lead_id: "lead-inbound", last_message_at: "2025-07-15T04:00:00.000Z" }],
      [],
    );
    expect(rows.map((row) => row.id)).toEqual(["lead-imported", "lead-inbound"]);
    expect(rows[0]!.conversation).toBeNull();
    expect(rows[1]!.conversation).not.toBeNull();
  });

  it("keeps existing inbound lead behaviour, including jobs", () => {
    const rows = composeInboxRows(
      [inbound],
      [{ lead_id: "lead-inbound", last_message_at: "2025-07-15T04:00:00.000Z" }],
      [{ lead_id: "lead-inbound", completion_status: "completed", completed_value: 320 }],
    );
    expect(rows[0]!.job).toEqual({
      lead_id: "lead-inbound",
      completion_status: "completed",
      completed_value: 320,
    });
  });

  it("falls back to creation time for last activity when there is no conversation", () => {
    const rows = composeInboxRows([imported], [], []);
    expect(inboxLastActivity(rows[0]!)).toBe(imported.created_at);
    expect(() => inboxLastActivity(rows[0]!)).not.toThrow();
  });

  it("handles null query results without crashing", () => {
    expect(composeInboxRows(null, null, null)).toEqual([]);
  });
});

describe("lead origin constraint contract", () => {
  it("accepts crm_import for the import-only path", () => {
    expect(IMPORT_LEAD_ORIGIN).toBe("crm_import");
    expect(isAllowedLeadOrigin(IMPORT_LEAD_ORIGIN)).toBe(true);
    expect(isAllowedLeadOrigin(insertFor().lead_origin)).toBe(true);
  });

  it("keeps existing valid lead origins accepted", () => {
    for (const origin of ["live", "historical", "reactivation"]) {
      expect(isAllowedLeadOrigin(origin)).toBe(true);
    }
    expect(LEAD_ORIGINS).toEqual(["live", "historical", "reactivation", "crm_import"]);
  });

  it("still rejects invalid origins", () => {
    for (const origin of ["", "import", "CRM_IMPORT", "captured", "crm-import"]) {
      expect(isAllowedLeadOrigin(origin)).toBe(false);
    }
  });

  it("leaves captureLead behaviour unchanged (null origin remains valid)", () => {
    expect(isAllowedLeadOrigin(null)).toBe(true);
    expect(isAllowedLeadOrigin(undefined)).toBe(true);
  });
});
