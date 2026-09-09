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

const tableDefaults: Record<string, Row> = {
  texto_accounts: {
    provisioning_state: "not_started",
    daily_send_cap: 100,
    credit_balance: 0,
    allocated_credits: 0,
  },
  texto_numbers: { assigned_business_id: null },
  sms_senders: { is_primary: true, active: true },
  messages: { delivery_status: "pending", direction: "outbound" },
  audit_events: {},
};

// Minimal Supabase query builder for these tests. It accumulates filters and
// applies updates only to rows that match all accumulated filters at terminal
// time, which matches the real PostgREST behaviour.
function createQueryBuilder(table: string) {
  const rows = store[table] ?? [];
  type Op =
    | { kind: "select"; fields: string[] | null; count: boolean }
    | { kind: "update"; patch: Row }
    | { kind: "insert"; values: Row[] }
    | { kind: "eq"; column: string; value: unknown }
    | { kind: "is"; column: string; value: unknown }
    | { kind: "neq"; column: string; value: unknown }
    | { kind: "gte"; column: string; value: string }
    | { kind: "lte"; column: string; value: string }
    | { kind: "order"; column: string; ascending: boolean }
    | { kind: "limit"; n: number };

  const ops: Op[] = [];

  function isNullLike(v: unknown) {
    return v === null || v === undefined;
  }

  function execute() {
    let working: Row[] = [...rows];
    let patch: Row | null = null;
    let fields: string[] | null = null;
    let countOnly = false;

    for (const op of ops) {
      switch (op.kind) {
        case "select":
          fields = op.fields;
          countOnly = op.count;
          break;
        case "update":
          patch = op.patch;
          break;
        case "insert": {
          const inserted: Row[] = [];
          for (const item of op.values) {
            const row = { ...tableDefaults[table], ...item, id: item.id ?? makeId(`${table}_id`) };
            store[table].push(row);
            inserted.push(row);
          }
          working = inserted;
          break;
        }
        case "eq":
          working = working.filter((r) => r[op.column] === op.value);
          break;
        case "is":
          working = working.filter((r) => (isNullLike(op.value) ? isNullLike(r[op.column]) : !isNullLike(r[op.column])));
          break;
        case "neq":
          working = working.filter((r) => r[op.column] !== op.value);
          break;
        case "gte":
          working = working.filter((r) => (r[op.column] as string) >= op.value);
          break;
        case "lte":
          working = working.filter((r) => (r[op.column] as string) <= op.value);
          break;
        case "order":
          working.sort((a, b) => {
            const av = a[op.column] as string | number | null;
            const bv = b[op.column] as string | number | null;
            if (av == null && bv == null) return 0;
            if (av == null) return op.ascending ? 1 : -1;
            if (bv == null) return op.ascending ? -1 : 1;
            if (av < bv) return op.ascending ? -1 : 1;
            if (av > bv) return op.ascending ? 1 : -1;
            return 0;
          });
          break;
        case "limit":
          working = working.slice(0, op.n);
          break;
      }
    }

    if (patch) {
      for (const row of working) {
        Object.assign(row, patch);
      }
    }

    if (countOnly) {
      return { data: null, error: null, count: working.length };
    }

    function project(row: Row | null): Row | null {
      if (!row) return null;
      if (!fields) return row;
      if (fields.length === 1 && fields[0] === "*") return row;
      const out: Row = {};
      for (const f of fields) {
        if (f in row) out[f] = row[f];
      }
      return out;
    }

    return { data: project(working[0] ?? null), error: null, count: null };
  }

  function executeAll() {
    // Same as execute but returns the full filtered array. Count-only queries
    // return a numeric count and no data.
    if (ops.some((op) => op.kind === "select" && op.count)) {
      const count = execute().count ?? 0;
      return { data: null, error: null, count };
    }
    let working = [...rows];
    let patch: Row | null = null;
    let fields: string[] | null = null;

    for (const op of ops) {
      switch (op.kind) {
        case "select":
          fields = op.fields;
          break;
        case "update":
          patch = op.patch;
          break;
        case "insert": {
          const inserted: Row[] = [];
          for (const item of op.values) {
            const row = { ...tableDefaults[table], ...item, id: item.id ?? makeId(`${table}_id`) };
            store[table].push(row);
            inserted.push(row);
          }
          working = inserted;
          break;
        }
        case "eq":
          working = working.filter((r) => r[op.column] === op.value);
          break;
        case "is":
          working = working.filter((r) => (isNullLike(op.value) ? isNullLike(r[op.column]) : !isNullLike(r[op.column])));
          break;
        case "neq":
          working = working.filter((r) => r[op.column] !== op.value);
          break;
        case "gte":
          working = working.filter((r) => (r[op.column] as string) >= op.value);
          break;
        case "lte":
          working = working.filter((r) => (r[op.column] as string) <= op.value);
          break;
        case "order":
          working.sort((a, b) => {
            const av = a[op.column] as string | number | null;
            const bv = b[op.column] as string | number | null;
            if (av == null && bv == null) return 0;
            if (av == null) return op.ascending ? 1 : -1;
            if (bv == null) return op.ascending ? -1 : 1;
            if (av < bv) return op.ascending ? -1 : 1;
            if (av > bv) return op.ascending ? 1 : -1;
            return 0;
          });
          break;
        case "limit":
          working = working.slice(0, op.n);
          break;
      }
    }

    if (patch) {
      for (const row of working) {
        Object.assign(row, patch);
      }
    }

    function project(row: Row | null): Row | null {
      if (!row) return null;
      if (!fields) return row;
      if (fields.length === 1 && fields[0] === "*") return row;
      const out: Row = {};
      for (const f of fields) {
        if (f in row) out[f] = row[f];
      }
      return out;
    }

    return { data: working.map(project), error: null, count: null };
  }

  const builder = {
    select(fields?: string | string[], opts?: { count?: string; head?: boolean }) {
      let parsed: string[] | null = null;
      if (opts?.count) {
        ops.push({ kind: "select", fields: null, count: true });
        return builder;
      }
      if (typeof fields === "string") {
        parsed = fields.split(",").map((s) => s.trim());
      } else if (Array.isArray(fields)) {
        parsed = fields;
      }
      ops.push({ kind: "select", fields: parsed, count: false });
      return builder;
    },
    eq(column: string, value: unknown) {
      ops.push({ kind: "eq", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      ops.push({ kind: "is", column, value });
      return builder;
    },
    neq(column: string, value: unknown) {
      ops.push({ kind: "neq", column, value });
      return builder;
    },
    gte(column: string, value: string) {
      ops.push({ kind: "gte", column, value });
      return builder;
    },
    lte(column: string, value: string) {
      ops.push({ kind: "lte", column, value });
      return builder;
    },
    order(column: string, opts?: { ascending?: boolean }) {
      ops.push({ kind: "order", column, ascending: opts?.ascending !== false });
      return builder;
    },
    limit(n: number) {
      ops.push({ kind: "limit", n });
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(execute());
    },
    single() {
      const result = execute();
      if (!result.data && result.count === null) {
        return Promise.resolve({ data: null, error: { message: "No rows found" }, count: null });
      }
      return Promise.resolve(result);
    },
    insert(values: Row | Row[]) {
      ops.push({ kind: "insert", values: Array.isArray(values) ? values : [values] });
      return {
        select: () => ({
          single: () => Promise.resolve(execute()),
        }),
      };
    },
    update(patch: Row) {
      ops.push({ kind: "update", patch });
      return builder;
    },
  };

  // Make the builder awaitable so unterminated select/update chains resolve.
  Object.defineProperty(builder, "then", {
    value: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      Promise.resolve(executeAll()).then(resolve, reject);
    },
  });

  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      return createQueryBuilder(table);
    },
    rpc() {
      throw new Error("RPC not mocked in this test");
    },
  },
}));

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

    console.log("sms_senders after provision", store.sms_senders);
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
    const provisioned = await provisionTextoAccount({ businessId: "biz-1", businessName: "Glocast", ownerEmail: "o@example.com" });
    console.log("provisioned", provisioned.account.id, provisioned.account.credit_balance, provisioned.account.provisioning_state);
    const allocated = await allocateCredits("biz-1", -1);
    console.log("allocated", allocated.credit_balance);
    const check = await checkTextoCredits("biz-1", 1);
    console.log("check", check);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/empty/);
  });

  it("allows sends with positive balance", async () => {
    await addNumberToPool({ number: "+61480000001" });
    await provisionTextoAccount({
      businessId: "biz-1",
      businessName: "Glocast",
      ownerEmail: "o@example.com",
      startingCredits: 10,
    });
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
