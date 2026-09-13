// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory tables for the reads/writes maybeAutoTopup performs.
type Row = Record<string, any>;
const store: { texto_accounts: Row[]; credit_topups: Row[]; businesses: Row[]; audit_events: Row[] } = {
  texto_accounts: [],
  credit_topups: [],
  businesses: [],
  audit_events: [],
};

let nextId = 1;
const makeId = () => `id-${nextId++}`;

function builder(table: keyof typeof store) {
  const ops: Array<{ kind: string; column?: string; value?: any; values?: any; patch?: Row }> = [];
  const matches = (row: Row) =>
    ops.every((op) => {
      if (op.kind === "eq") return row[op.column!] === op.value;
      if (op.kind === "notnull") return row[op.column!] !== null && row[op.column!] !== undefined;
      if (op.kind === "gte") return typeof row[op.column!] === "string" && row[op.column!] >= op.value;
      return true;
    });
  const api: any = {
    select: (_fields?: string, opts?: { count?: string }) => {
      if (opts?.count) api._count = true;
      return api;
    },
    insert: (values: Row[] | Row) => {
      const list = Array.isArray(values) ? values : [values];
      const inserted = list.map((v) => ({ id: makeId(), ...v }));
      store[table].push(...inserted);
      api._inserted = inserted;
      return api;
    },
    update: (patch: Row) => {
      ops.push({ kind: "update", patch });
      return api;
    },
    eq: (column: string, value: any) => (ops.push({ kind: "eq", column, value }), api),
    not: (column: string, _op: string, value: any) =>
      (value === null ? ops.push({ kind: "notnull", column }) : ops.push({ kind: "eq", column, value }), api),
    gte: (column: string, value: any) => (ops.push({ kind: "gte", column, value }), api),
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      const rows = store[table].filter(matches);
      return { data: rows[0] ?? null, error: null };
    },
    single: async () => ({ data: api._inserted?.[0] ?? store[table].filter(matches)[0] ?? null, error: null }),
    then: (resolve: any) => {
      const updates = ops.filter((o) => o.kind === "update");
      if (updates.length) {
        for (const row of store[table]) if (matches(row)) Object.assign(row, updates[updates.length - 1].patch);
        return resolve({ error: null });
      }
      const rows = store[table].filter(matches);
      if (api._count) return resolve({ data: null, count: rows.length, error: null });
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: keyof typeof store) => builder(table) },
}));

const paymentIntents: Array<Record<string, any>> = [];
const intentsById = new Map<string, any>();
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: () => ({
    paymentIntents: {
      retrieve: async (id: string) => {
        const intent = intentsById.get(id);
        if (!intent) throw new Error("No such payment_intent");
        return intent;
      },
      create: async (payload: Record<string, any>) => {
        paymentIntents.push(payload);
        return { id: `pi_auto_${paymentIntents.length}`, status: "succeeded" };
      },
    },
    subscriptions: { retrieve: async () => ({ default_payment_method: null }) },
  }),
  getStripeErrorMessage: (e: any) => e?.message ?? "Stripe request failed",
}));

const { maybeAutoTopup } = await import("./auto-topup.server");

function account(overrides: Row = {}): Row {
  return {
    id: makeId(),
    business_id: "biz-1",
    credit_balance: 10,
    auto_topup_enabled: true,
    auto_topup_threshold: 85,
    auto_topup_pack_id: "pack_1500",
    auto_topup_attempted_at: null,
    auto_topup_failures: 0,
    ...overrides,
  };
}

describe("maybeAutoTopup", () => {
  beforeEach(() => {
    store.texto_accounts = [];
    store.credit_topups = [];
    store.businesses = [{ id: "biz-1", stripe_customer_id: null, stripe_subscription_id: null, subscription_status: "active" }];
    store.audit_events = [];
    paymentIntents.length = 0;
    intentsById.clear();
  });

  it("does nothing when automatic top-ups are off", async () => {
    store.texto_accounts = [account({ auto_topup_enabled: false })];
    const result = await maybeAutoTopup("biz-1");
    expect(result.ok).toBe(false);
    expect(paymentIntents).toHaveLength(0);
  });

  it("does nothing while the balance is at or above the threshold", async () => {
    store.texto_accounts = [account({ credit_balance: 500 })];
    const result = await maybeAutoTopup("biz-1");
    expect(result.ok).toBe(false);
    expect(paymentIntents).toHaveLength(0);
  });

  it("does nothing without a saved card", async () => {
    store.texto_accounts = [account()];
    const result = await maybeAutoTopup("biz-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_saved_card");
    expect(store.credit_topups.filter((r) => r.status === "pending")).toHaveLength(0);
  });

  it("charges the card from the last paid top-up and allocates credits", async () => {
    store.texto_accounts = [account()];
    intentsById.set("pi_prev", { payment_method: "pm_card", customer: "cus_1" });
    store.credit_topups = [
      {
        id: "old",
        business_id: "biz-1",
        status: "paid",
        stripe_payment_intent_id: "pi_prev",
        credited_at: new Date().toISOString(),
      },
    ];
    const result = await maybeAutoTopup("biz-1");
    expect(result).toEqual({ ok: true, credits: 1500 });
    expect(paymentIntents).toHaveLength(1);
    expect(paymentIntents[0].customer).toBe("cus_1");
    expect(paymentIntents[0].payment_method).toBe("pm_card");
    expect(paymentIntents[0].off_session).toBe(true);
    expect(store.texto_accounts[0].credit_balance).toBe(1510);
    expect(store.credit_topups.some((r) => r.status === "paid" && r.source === "auto")).toBe(true);
  });

  it("respects the 15-minute cooldown between attempts", async () => {
    store.texto_accounts = [account({ auto_topup_attempted_at: new Date().toISOString() })];
    const result = await maybeAutoTopup("biz-1");
    expect(result.ok).toBe(false);
    expect(paymentIntents).toHaveLength(0);
  });

  it("caps automatic purchases at three per 24 hours", async () => {
    store.texto_accounts = [account()];
    intentsById.set("pi_prev", { payment_method: "pm_card", customer: "cus_1" });
    const dayAgo = new Date(Date.now() - 60_000).toISOString();
    store.credit_topups = [
      { id: "p0", business_id: "biz-1", status: "paid", source: "auto", created_at: dayAgo },
      { id: "p1", business_id: "biz-1", status: "paid", source: "auto", created_at: dayAgo },
      { id: "p2", business_id: "biz-1", status: "paid", source: "auto", created_at: dayAgo },
      {
        id: "manual",
        business_id: "biz-1",
        status: "paid",
        stripe_payment_intent_id: "pi_prev",
        credited_at: dayAgo,
      },
    ];
    const result = await maybeAutoTopup("biz-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("daily_limit");
    expect(paymentIntents).toHaveLength(0);
  });
});
