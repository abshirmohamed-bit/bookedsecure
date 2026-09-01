import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  DUPLICATE_LEAD_CLIENT_MESSAGE,
  DUPLICATE_LEAD_CODE,
  DUPLICATE_LEAD_MESSAGE,
  classifyQuoteResult,
  duplicateQuoteResponse,
  isDuplicateQuoteResult,
  quoteErrorMessage,
} from "@/lib/quote-duplicate";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const MOBILE = "+61412345565";

let db: FakeDb;
let client: ReturnType<typeof createFakeSupabase>;

// The engine reads supabaseAdmin at module scope, so the fake stands in for it.
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return client;
  },
}));

function business(id: string) {
  return {
    id,
    name: id === TENANT ? "Glocast" : "Other Detailer",
    phone_number: "+61400000000",
    default_sms_provider: "telnyx",
    automation_enabled: false,
    quiet_hours_start: 20,
    quiet_hours_end: 8,
    sms_signature: null,
    timezone: "Australia/Sydney",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function leadRow(overrides: Record<string, any> = {}) {
  return {
    id: `lead-${Math.random().toString(36).slice(2, 8)}`,
    business_id: TENANT,
    name: "Existing Customer",
    mobile_number: MOBILE,
    status: "new",
    deleted_at: null,
    external_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function freshDb(leads: Record<string, any>[] = []): FakeDb {
  return {
    businesses: [business(TENANT), business(OTHER_TENANT)],
    leads,
    conversations: [],
    messages: [],
    jobs: [],
    automation_jobs: [],
    automation_rules: [],
    consent_events: [],
    ai_outputs: [],
    ai_usage_events: [],
    notifications: [],
    sms_usage_daily: [],
    sms_usage_periods: [],
    sms_senders: [],
    audit_events: [],
  };
}

async function capture(input: Record<string, any>) {
  const { captureLead } = await import("@/lib/lead-engine.server");
  return captureLead({
    businessId: TENANT,
    name: "New Customer",
    mobile_number: MOBILE,
    suburb: "Bondi",
    source_channel: "quote_form",
    consent: true,
    consent_text: "I agree to SMS about this enquiry. Reply STOP to opt out.",
    ...input,
  } as never);
}

/** Tables that must never be written on a duplicate submission. */
const SIDE_EFFECT_TABLES = [
  "leads",
  "conversations",
  "messages",
  "jobs",
  "automation_jobs",
  "consent_events",
  "ai_outputs",
  "ai_usage_events",
  "notifications",
  "sms_usage_daily",
  "sms_usage_periods",
  "businesses",
  "automation_rules",
];

function mutations() {
  return (client.writes as { table: string; op: string }[]).filter((entry) => entry.op !== "select");
}

describe("duplicate response contract", () => {
  it("is an explicit, coded, non-success response", () => {
    expect(duplicateQuoteResponse()).toEqual({
      ok: false,
      duplicate: true,
      code: "DUPLICATE_LEAD",
      message: DUPLICATE_LEAD_MESSAGE,
    });
    expect(DUPLICATE_LEAD_CODE).toBe("DUPLICATE_LEAD");
  });

  it("never leaks the existing lead id or customer data", () => {
    const response = duplicateQuoteResponse() as unknown as Record<string, unknown>;
    expect(Object.keys(response).sort()).toEqual(["code", "duplicate", "message", "ok"]);
    expect(JSON.stringify(response)).not.toMatch(/leadId|lead_id|lead-|\+614|@/i);
  });

  it("renders as an error and never as success", () => {
    const response = duplicateQuoteResponse();
    expect(classifyQuoteResult(response)).toBe("duplicate");
    expect(isDuplicateQuoteResult(response)).toBe(true);
    expect(classifyQuoteResult(response)).not.toBe("success");
    expect(quoteErrorMessage(response)).toBe(DUPLICATE_LEAD_CLIENT_MESSAGE);
  });

  it("distinguishes success, duplicate and ordinary validation errors", () => {
    expect(classifyQuoteResult({ ok: true, duplicate: false, acknowledgementSent: true })).toBe(
      "success",
    );
    expect(classifyQuoteResult({ ok: false, error: "Please enter a valid mobile number." })).toBe(
      "error",
    );
    expect(quoteErrorMessage({ ok: false, error: "Please enter a valid mobile number." })).toBe(
      "Please enter a valid mobile number.",
    );
    expect(classifyQuoteResult(undefined)).toBe("error");
    expect(quoteErrorMessage(undefined)).toMatch(/went wrong/i);
    expect(isDuplicateQuoteResult({ ok: false, error: "boom" })).toBe(false);
  });
});

describe("duplicate protection in captureLead", () => {
  beforeEach(() => {
    db = freshDb();
    client = createFakeSupabase(db);
  });

  it("treats an active lead from the same number as a duplicate", async () => {
    db["leads"]!.push(leadRow());
    client = createFakeSupabase(db);
    const result = await capture({});
    expect(result.duplicate).toBe(true);
    expect(result.acknowledgementSent).toBe(false);
    expect(db["leads"]!.length).toBe(1);
  });

  it("still treats a soft-deleted lead from the same number as a duplicate", async () => {
    db["leads"]!.push(leadRow({ deleted_at: new Date().toISOString() }));
    client = createFakeSupabase(db);
    const result = await capture({});
    expect(result.duplicate).toBe(true);
    expect(db["leads"]!.length).toBe(1);
  });

  it("suppresses a second submission inside the 30-minute window", async () => {
    db["leads"]!.push(
      leadRow({ created_at: new Date(Date.now() - 29 * 60 * 1000).toISOString() }),
    );
    client = createFakeSupabase(db);
    expect((await capture({})).duplicate).toBe(true);
    expect(db["leads"]!.length).toBe(1);
  });

  it("accepts a new enquiry once the 30-minute window has passed", async () => {
    db["leads"]!.push(
      leadRow({ created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
    );
    client = createFakeSupabase(db);
    const result = await capture({});
    expect(result.duplicate).toBe(false);
    expect(db["leads"]!.length).toBe(2);
  });

  it("creates no lead, conversation, job, message, consent, usage or notification on a duplicate", async () => {
    db["leads"]!.push(leadRow());
    client = createFakeSupabase(db);
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await capture({});
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
    for (const table of SIDE_EFFECT_TABLES) {
      expect(mutations().some((entry) => entry.table === table)).toBe(false);
    }
    expect(db["messages"]!.length).toBe(0);
    expect(db["conversations"]!.length).toBe(0);
    expect(db["automation_jobs"]!.length).toBe(0);
    expect(db["sms_usage_daily"]!.length).toBe(0);
    expect(db["ai_usage_events"]!.length).toBe(0);
  });

  it("is tenant isolated: another tenant's lead is not a duplicate here", async () => {
    db["leads"]!.push(leadRow({ business_id: OTHER_TENANT }));
    client = createFakeSupabase(db);
    const result = await capture({});
    expect(result.duplicate).toBe(false);
    expect(db["leads"]!.filter((row) => row["business_id"] === TENANT).length).toBe(1);
    expect(db["leads"]!.filter((row) => row["business_id"] === OTHER_TENANT).length).toBe(1);
  });

  it("is idempotent for a repeated submission with the same external id", async () => {
    db["leads"]!.push(leadRow({ external_id: "form:abc", created_at: "2026-01-01T00:00:00.000Z" }));
    client = createFakeSupabase(db);
    const first = await capture({ external_id: "form:abc" });
    const second = await capture({ external_id: "form:abc" });
    expect(first.duplicate).toBe(true);
    expect(second.leadId).toBe(first.leadId);
    expect(db["leads"]!.length).toBe(1);
    expect(mutations()).toEqual([]);
  });
});

describe("submission surfaces report duplicates explicitly", () => {
  it("the public quote server function returns the coded duplicate response", async () => {
    const source = await readFile("src/lib/public.functions.ts", "utf8");
    expect(source).toContain("if (result.duplicate)");
    expect(source).toContain("duplicateQuoteResponse()");
    // The success branch is explicitly not a duplicate.
    expect(source).toContain("duplicate: false as const");
  });

  it("the widget intake route does not return a lead id as success on a duplicate", async () => {
    const source = await readFile("src/routes/api/public/leads/intake.ts", "utf8");
    expect(source).toContain("if (result.duplicate)");
    expect(source).toContain("duplicateQuoteResponse()");
  });

  it("the public form ends the progress state and shows a non-success duplicate screen", async () => {
    const source = await readFile("src/routes/quote.$slug.tsx", "utf8");
    expect(source).toContain("classifyQuoteResult(result)");
    expect(source).toContain('setDuplicate(outcome === "duplicate")');
    expect(source).toContain("DUPLICATE_LEAD_CLIENT_MESSAGE");
    // Progress state always clears, and the duplicate screen is never the success screen.
    expect(source).toContain("finally {\n      setBusy(false);");
    expect(source).toContain("if (duplicate) {");
    expect(source).toContain("Back to the form");
    // No automatic retry.
    expect(source).not.toMatch(/setTimeout\([^)]*submit/);
    expect(source).not.toMatch(/setInterval|autoRetry|retryCount/i);
  });
});
