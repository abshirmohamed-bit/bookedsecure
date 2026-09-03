/**
 * Behavioural regression tests for the Phase 4 step 2 attribution plumbing.
 *
 * The real `sendSms` runs against an in-memory database. No provider is
 * contacted (the provider module is replaced by a recorder), no job is
 * enqueued, no booking or notification is created and no execution gate is
 * consulted, because step 2 adds attribution metadata only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const db: Record<string, Row[]> = {};
const providerCalls: { to: string; body: string }[] = [];
const usageCalls: Row[] = [];
let capBlocked = false;

function reset() {
  for (const key of Object.keys(db)) delete db[key];
  providerCalls.length = 0;
  usageCalls.length = 0;
  capBlocked = false;
  db["businesses"] = [
    {
      id: "biz-1",
      name: "Glocast",
      phone_number: "+61400000000",
      default_sms_provider: "simulated",
      automation_enabled: true,
      quiet_hours_start: 21,
      quiet_hours_end: 8,
      sms_signature: null,
      timezone: "Australia/Sydney",
    },
    {
      id: "biz-2",
      name: "Other",
      phone_number: null,
      default_sms_provider: "simulated",
      automation_enabled: true,
      quiet_hours_start: 21,
      quiet_hours_end: 8,
      sms_signature: null,
      timezone: "Australia/Sydney",
    },
  ];
  db["leads"] = [
    {
      id: "lead-1",
      business_id: "biz-1",
      name: "Sam",
      mobile_number: "+61468045220",
      status: "new",
      opted_out_at: null,
      first_contacted_at: null,
      sms_suppressed_at: null,
      sms_suppression_reason: null,
      lead_origin: "live",
      source_channel: "quote_form",
    },
  ];
  db["sms_senders"] = [
    {
      id: "sender-1",
      business_id: "biz-1",
      phone_number: "+61400111222",
      provider: "simulated",
      credential_mode: "platform",
      subaccount_sid: null,
      credential_secret_name: null,
      is_primary: true,
      active: true,
      messaging_profile_id: null,
    },
  ];
  db["messages"] = [];
  db["audit_events"] = [];
  db["conversations"] = [];
  db["automation_rules"] = [];
  db["agent_actions"] = [];
  db["notifications"] = [];
  db["automation_jobs"] = [];
}

function matches(row: Row, filters: { op: string; column: string; value: any }[]) {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.op === "eq") return actual === f.value;
    if (f.op === "in") return (f.value as any[]).includes(actual);
    if (f.op === "gt") return actual > f.value;
    if (f.op === "notNull") return actual !== null && actual !== undefined;
    return true;
  });
}

function table(name: string): Row[] {
  db[name] ??= [];
  return db[name]!;
}

function builder(name: string) {
  const filters: { op: string; column: string; value: any }[] = [];
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;

  const rows = () => table(name).filter((row) => matches(row, filters));

  const settle = (single: boolean) => {
    if (mode === "insert") {
      const inserted = { id: `${name}-${table(name).length + 1}`, ...payload };
      // Unique (business_id, idempotency_key) on messages.
      if (
        name === "messages" &&
        inserted["idempotency_key"] &&
        table(name).some(
          (r) =>
            r["business_id"] === inserted["business_id"] &&
            r["idempotency_key"] === inserted["idempotency_key"],
        )
      ) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      table(name).push(inserted);
      return { data: inserted, error: null };
    }
    if (mode === "update") {
      const affected = rows();
      for (const row of affected) Object.assign(row, payload);
      return { data: single ? (affected[0] ?? null) : affected, error: null };
    }
    const found = rows();
    return { data: single ? (found[0] ?? null) : found, error: single && !found[0] ? { message: "not found" } : null };
  };

  const chain: any = {
    select: () => chain,
    insert: (data: Row) => {
      mode = "insert";
      payload = data;
      return chain;
    },
    update: (data: Row) => {
      mode = "update";
      payload = data;
      return chain;
    },
    eq: (column: string, value: any) => {
      filters.push({ op: "eq", column, value });
      return chain;
    },
    in: (column: string, value: any[]) => {
      filters.push({ op: "in", column, value });
      return chain;
    },
    gt: (column: string, value: any) => {
      filters.push({ op: "gt", column, value });
      return chain;
    },
    lt: () => chain,
    not: (column: string) => {
      filters.push({ op: "notNull", column, value: null });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const result = settle(true);
      return { data: result.data, error: mode === "select" ? null : result.error };
    },
    single: async () => settle(true),
    then: (resolve: (value: any) => unknown) => Promise.resolve(settle(false)).then(resolve),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (name: string) => builder(name) },
}));

vi.mock("@/lib/sms/provider.server", () => ({
  getProvider: () => ({
    name: "simulated",
    sendMessage: async (input: { to: string; body: string }) => {
      providerCalls.push({ to: input.to, body: input.body });
      return {
        providerMessageId: `sim_${providerCalls.length}`,
        deliveryStatus: "delivered",
        provider: "simulated",
        providerCost: 0,
      };
    },
    formatProviderError: (error: unknown) => String(error),
  }),
}));

vi.mock("@/lib/usage.server", () => ({
  checkSmsCap: async () => (capBlocked ? { blocked: true, reason: "cap", used: 1, cap: 1 } : { blocked: false }),
  recordSmsUsage: async (input: Row) => {
    usageCalls.push(input);
  },
}));

const { sendSms } = await import("./lead-engine.server");

const baseInput = {
  businessId: "biz-1",
  leadId: "lead-1",
  body: "Hi Sam",
  kind: "manual" as const,
  respectAutomation: false,
};

beforeEach(() => {
  reset();
  // Mid-morning Sydney: outside quiet hours.
  vi.setSystemTime(new Date("2026-09-03T02:00:00.000Z"));
});

describe("existing callers are unaffected", () => {
  it("sends with no attribution fields and stores null attribution", async () => {
    const result = await sendSms(baseInput);
    expect(result.sent).toBe(true);
    expect(providerCalls).toHaveLength(1);
    const message = db["messages"]![0]!;
    expect(message["message_source"]).toBe("manual");
    expect(message["sequence_id"]).toBeNull();
    expect(message["agent_action_id"]).toBeNull();
    expect(message["template_id"]).toBeNull();
  });

  it("keeps derived message sources for automated kinds", async () => {
    await sendSms({ ...baseInput, kind: "acknowledgement", respectAutomation: true });
    expect(db["messages"]![0]!["message_source"]).toBe("quote_page");
  });

  it("keeps usage and segment accounting unchanged", async () => {
    await sendSms(baseInput);
    expect(usageCalls).toEqual([
      { businessId: "biz-1", segmentsOut: 1, messagesOut: 1, providerCost: 0 },
    ]);
    expect(db["messages"]![0]!["segments"]).toBe(1);
  });

  it("keeps STOP / opt-out behaviour unchanged", async () => {
    db["leads"]![0]!["opted_out_at"] = new Date().toISOString();
    const result = await sendSms(baseInput);
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/opted out/i);
    expect(providerCalls).toHaveLength(0);
    expect(db["messages"]).toHaveLength(0);
  });

  it("keeps suppression behaviour unchanged for automated sends", async () => {
    db["leads"]![0]!["sms_suppressed_at"] = new Date().toISOString();
    db["leads"]![0]!["sms_suppression_reason"] = "permanent failure";
    const blocked = await sendSms({ ...baseInput, kind: "follow_up", respectAutomation: true });
    expect(blocked.sent).toBe(false);
    expect(blocked.reason).toMatch(/suppressed/i);
    // Manual sends stay possible, exactly as before.
    const manual = await sendSms(baseInput);
    expect(manual.sent).toBe(true);
  });

  it("keeps reachability / invalid-number checks unchanged", async () => {
    db["leads"]![0]!["status"] = "invalid";
    const result = await sendSms(baseInput);
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/invalid/i);
    expect(providerCalls).toHaveLength(0);
  });

  it("keeps the quiet-hours gate unchanged", async () => {
    vi.setSystemTime(new Date("2026-09-03T13:00:00.000Z")); // 23:00 Sydney
    const result = await sendSms({ ...baseInput, sequenceId: "seq_a" });
    expect(result.sent).toBe(false);
    expect(result.code).toBe("quiet_hours_blocked");
    expect(providerCalls).toHaveLength(0);
    expect(db["messages"]).toHaveLength(0);
  });

  it("keeps the usage cap gate unchanged", async () => {
    capBlocked = true;
    const result = await sendSms({ ...baseInput, kind: "follow_up", respectAutomation: true });
    expect(result.sent).toBe(false);
    expect(providerCalls).toHaveLength(0);
  });

  it("keeps idempotent duplicate suppression unchanged", async () => {
    const first = await sendSms({ ...baseInput, idempotencyKey: "key-1" });
    const second = await sendSms({ ...baseInput, idempotencyKey: "key-1" });
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(providerCalls).toHaveLength(1);
    expect(db["messages"]).toHaveLength(1);
  });
});

describe("agent attribution is stored only when explicitly supplied", () => {
  beforeEach(() => {
    db["agent_actions"]!.push({
      id: "11111111-2222-3333-4444-555555555555",
      business_id: "biz-1",
      lead_id: "lead-1",
    });
  });

  it("persists sequence, action and template ids plus the explicit source", async () => {
    const result = await sendSms({
      ...baseInput,
      source: "agent_sequence",
      sequenceId: "contact_only_introduction",
      actionKind: "send_sms",
      agentActionId: "11111111-2222-3333-4444-555555555555",
      templateId: "intro_step_1",
    });
    expect(result.sent).toBe(true);
    const message = db["messages"]![0]!;
    expect(message["message_source"]).toBe("agent_sequence");
    expect(message["sequence_id"]).toBe("contact_only_introduction");
    expect(message["agent_action_id"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(message["template_id"]).toBe("intro_step_1");
  });

  it("keeps one message and one attribution record across duplicate retries", async () => {
    const attributed = {
      ...baseInput,
      idempotencyKey: "agent-key-1",
      source: "agent_sequence" as const,
      sequenceId: "contact_only_introduction",
      agentActionId: "11111111-2222-3333-4444-555555555555",
      templateId: "intro_step_1",
    };
    await sendSms(attributed);
    const repeat = await sendSms(attributed);
    expect(repeat.duplicate).toBe(true);
    expect(db["messages"]).toHaveLength(1);
    expect(providerCalls).toHaveLength(1);
    expect(db["messages"]![0]!["sequence_id"]).toBe("contact_only_introduction");
  });

  it("rejects an unknown agent action reference without sending", async () => {
    const result = await sendSms({
      ...baseInput,
      agentActionId: "99999999-9999-9999-9999-999999999999",
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/unknown agent action/i);
    expect(providerCalls).toHaveLength(0);
    expect(db["messages"]).toHaveLength(0);
  });

  it("rejects a malformed agent action reference without touching the database", async () => {
    const result = await sendSms({ ...baseInput, agentActionId: "not-a-uuid" });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/invalid agent action reference/i);
    expect(db["messages"]).toHaveLength(0);
    expect(db["audit_events"]).toHaveLength(0);
  });

  it("is tenant-scoped: another tenant's action reference is refused", async () => {
    db["agent_actions"]!.push({
      id: "22222222-2222-3333-4444-555555555555",
      business_id: "biz-2",
      lead_id: null,
    });
    const result = await sendSms({
      ...baseInput,
      agentActionId: "22222222-2222-3333-4444-555555555555",
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/unknown agent action/i);
    expect(providerCalls).toHaveLength(0);
  });

  it("refuses an action reference that belongs to a different lead", async () => {
    db["agent_actions"]!.push({
      id: "33333333-2222-3333-4444-555555555555",
      business_id: "biz-1",
      lead_id: "lead-other",
    });
    const result = await sendSms({
      ...baseInput,
      agentActionId: "33333333-2222-3333-4444-555555555555",
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/different lead/i);
  });
});

describe("no execution side effects occur", () => {
  it("creates no jobs, notifications or bookings on any path", async () => {
    await sendSms(baseInput);
    await sendSms({ ...baseInput, kind: "follow_up", respectAutomation: true });
    expect(db["automation_jobs"]).toHaveLength(0);
    expect(db["notifications"]).toHaveLength(0);
    expect(db["agent_actions"]).toHaveLength(0);
  });
});
