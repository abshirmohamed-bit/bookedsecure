import { beforeEach, describe, expect, it, vi } from "vitest";

// Stateful in-memory store that mirrors the tables the account layer touches.
type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {
  texto_accounts: [],
  texto_numbers: [],
  sms_senders: [],
  messages: [],
  audit_events: [],
};

let nextId = 1;
function makeId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const rows = store[table] ?? [];
      let filtered = [...rows];
      let selected: string[] | null = null;
      let countMode: { exact: boolean; head: boolean } | null = null;
      let singleValue = false;
      let eqClauses: { column: string; value: unknown }[] = [];

      const chain = {
        select(fields?: string | string[], opts?: { count?: string; head?: boolean }) {
          if (opts?.count) {
            countMode = { exact: opts.count === "exact", head: !!opts.head };
          } else if (typeof fields === "string") {
            selected = fields.split(",").map((s) => s.trim());
          } else if (Array.isArray(fields)) {
            selected = fields;
          } else {
            selected = null;
          }
          return chain;
        },
        eq(column: string, value: unknown) {
          filtered = filtered.filter((r) => r[column] === value);
          eqClauses.push({ column, value });
          return chain;
        },
        is(column: string, value: unknown) {
          filtered = filtered.filter((r) => (value === null ? r[column] === null : r[column] !== null));
          return chain;
        },
        neq(column: string, value: unknown) {
          filtered = filtered.filter((r) => r[column] !== value);
          return chain;
        },
        gte(column: string, value: unknown) {
          filtered = filtered.filter((r) => (r[column] as string) >= (value as string));
          return chain;
        },
        lte(column: string, value: unknown) {
          filtered = filtered.filter((r) => (r[column] as string) <= (value as string));
          return chain;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          filtered.sort((a, b) => {
            const av = a[column] as string | number | null;
            const bv = b[column] as string | number | null;
            if (av == null && bv == null) return 0;
            if (av == null) return opts?.ascending === false ? -1 : 1;
            if (bv == null) return opts?.ascending === false ? 1 : -1;
            if (av < bv) return opts?.ascending === false ? 1 : -1;
            if (av > bv) return opts?.ascending === false ? -1 : 1;
            return 0;
          });
          return chain;
        },
        limit(n: number) {
          filtered = filtered.slice(0, n);
          return chain;
        },
        maybeSingle() {
          singleValue = true;
          const row = filtered[0] ?? null;
          const projected = selected ? project(row, selected) : row;
          return Promise.resolve({ data: projected, error: null });
        },
        single() {
          singleValue = true;
          const row = filtered[0] ?? null;
          const projected = selected ? project(row, selected) : row;
          if (!row) return Promise.resolve({ data: null, error: { message: "No rows found" } });
          return Promise.resolve({ data: projected, error: null });
        },
        insert(values: Row | Row[]) {
          const items = Array.isArray(values) ? values : [values];
          for (const item of items) {
            const row = { ...item, id: item.id ?? makeId(`${table}_id`) };
            store[table].push(row);
            filtered.push(row);
          }
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: filtered[filtered.length - 1] ?? null, error: null }),
            }),
          };
        },
        update(patch: Row) {
          for (const row of filtered) {
            Object.assign(row, patch);
          }
          return {
            eq(column: string, value: unknown) {
              // already applied through chained calls in this mock
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
                }),
              };
            },
            select: () => ({
              single: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
            }),
          };
        },
      };

      // count/head path
      chain.select = function (fields?: string | string[], opts?: { count?: string; head?: boolean }) {
        if (opts?.count) {
          countMode = { exact: opts.count === "exact", head: !!opts.head };
        } else if (typeof fields === "string") {
          selected = fields.split(",").map((s) => s.trim());
        } else if (Array.isArray(fields)) {
          selected = fields;
        } else {
          selected = null;
        }
        if (countMode) {
          return Promise.resolve({
            data: null,
            error: null,
            count: filtered.length,
          });
        }
        return chain;
      };

      return chain;
    },
    rpc() {
      throw new Error("RPC not mocked in this test");
    },
  },
}));

function project(row: Row | null, fields: string[]): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const f of fields) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

beforeEach(() => {
  for (const key of Object.keys(store)) {
    store[key] = [];
  }
  nextId = 1;
});

const {
  provisionTextoAccount,
  allocateCredits,
  checkTextoCredits,
  checkTextoDailyCap,
  addNumberToPool,
  getTextoAccountReport,
  getTextoGroupReport,
  recallTextoNumber,
} = await import("./texto-accounts.server");

describe("texto account provisioning", () => {
  it("queues when no numbers are available", async () => {
    const result = await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "owner@glocast.example",
    });
    expect(result.ok).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.account.provisioning_state).toBe("queued_no_number");
  });

  it("creates an account, assigns a number, and records an sms sender", async () => {
    await addNumberToPool({ number: "+61480000001" });

    const result = await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "owner@glocast.example",
      startingCredits: 50,
      dailySendCap: 200,
    });

    expect(result.ok).toBe(true);
    expect(result.account.provisioning_state).toBe("active");
    expect(result.account.credit_balance).toBe(50);
    expect(result.account.daily_send_cap).toBe(200);
    expect(result.number.number).toBe("+61480000001");
    expect(result.number.status).toBe("assigned");
    expect(result.number.assigned_business_id).toBe("biz-1");

    const sender = store.sms_senders.find((s) => s.business_id === "biz-1");
    expect(sender).toMatchObject({
      phone_number: "+61480000001",
      provider: "texto",
      is_primary: true,
      active: true,
    });
  });

  it("is idempotent for an already-active account", async () => {
    await addNumberToPool({ number: "+61480000001" });
    const first = await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "owner@glocast.example",
      startingCredits: 50,
    });

    // consume a credit
    await allocateCredits("biz-1", -1);

    const second = await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "owner@glocast.example",
      startingCredits: 999,
    });

    expect(second.ok).toBe(true);
    expect(second.account.id).toBe(first.account.id);
    expect(second.number.id).toBe(first.number.id);
    // credits should not be double-allocated on re-run
    expect(second.account.credit_balance).toBe(first.account.credit_balance);
  });

  it("assigns numbers to different tenants without overlap", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await addNumberToPool({ number: "+61480000002" });

    const a = await provisionTextoAccount({
      businessId: "biz-a",
      businessName: "A",
      ownerEmail: "a@example.com",
    });
    const b = await provisionTextoAccount({
      businessId: "biz-b",
      businessName: "B",
      ownerEmail: "b@example.com",
    });

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.number.number).not.toBe(b.number.number);
    expect(a.number.assigned_business_id).toBe("biz-a");
    expect(b.number.assigned_business_id).toBe("biz-b");
  });

  it("recalls a number and marks the sender inactive", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await provisionTextoAccount({ businessId: "biz-1", businessName: "Glocast", ownerEmail: "o@example.com" });
    await recallTextoNumber("biz-1");
    const number = store.texto_numbers.find((n) => n.number === "+61480000001");
    expect(number?.status).toBe("available");
    expect(number?.assigned_business_id).toBeNull();
    const sender = store.sms_senders.find((s) => s.business_id === "biz-1");
    expect(sender?.active).toBe(false);
    expect(sender?.is_primary).toBe(false);
  });
});

describe("texto credit and daily cap checks", () => {
  it("blocks sends when no account exists", async () => {
    const check = await checkTextoCredits("biz-1", 1);
    expect(check.ok).toBe(false);
  });

  it("blocks sends when credit balance is zero", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await provisionTextoAccount({ businessId: "biz-1", businessName: "Glocast", ownerEmail: "o@example.com" });
    await allocateCredits("biz-1", -1);
    const check = await checkTextoCredits("biz-1", 1);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/empty/);
  });

  it("allows sends with positive balance", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await provisionTextoAccount({ businessId: "biz-1", businessName: "Glocast", ownerEmail: "o@example.com" });
    const check = await checkTextoCredits("biz-1", 1);
    expect(check.ok).toBe(true);
  });

  it("blocks automated sends at the daily cap but not manual replies", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "o@example.com",
      dailySendCap: 1,
    });
    store.messages.push({
      id: "m-1",
      business_id: "biz-1",
      direction: "outbound",
      created_at: new Date().toISOString(),
    });

    const automated = await checkTextoDailyCap("biz-1", true);
    expect(automated.ok).toBe(false);

    const manual = await checkTextoDailyCap("biz-1", false);
    expect(manual.ok).toBe(true);
  });
});

describe("texto reporting", () => {
  it("counts local outbound, inbound and failures for the account report", async () => {
    store.messages.push(
      { id: "m-1", business_id: "biz-1", direction: "outbound", delivery_status: "delivered", created_at: new Date().toISOString() },
      { id: "m-2", business_id: "biz-1", direction: "outbound", delivery_status: "failed", created_at: new Date().toISOString() },
      { id: "m-3", business_id: "biz-1", direction: "inbound", created_at: new Date().toISOString() },
    );
    const report = await getTextoAccountReport("biz-1", {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(report.messagesOut).toBe(2);
    expect(report.delivered).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.messagesIn).toBe(1);
    expect(report.creditsUsed).toBe(2);
  });

  it("groups counts across tenants for the platform report", async () => {
    store.messages.push(
      { id: "m-1", business_id: "biz-1", direction: "outbound", delivery_status: "delivered", created_at: new Date().toISOString() },
      { id: "m-2", business_id: "biz-2", direction: "outbound", delivery_status: "delivered", created_at: new Date().toISOString() },
    );
    const report = await getTextoGroupReport({
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(report.totalMessagesOut).toBe(2);
    expect(report.totalDelivered).toBe(2);
    expect(report.accounts).toBe(2);
  });
});
