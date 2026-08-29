// In-memory stand-in for the service-role client's webhook_events table.
// Models exactly the operations webhook.server.ts performs: insert with a
// unique index on (provider, event_id), a filtered read, and a conditional
// UPDATE ... WHERE processed_at IS NULL AND claim is stale/absent RETURNING id.

export type WebhookEventRow = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  business_id: string | null;
  signature_verified: boolean;
  created_at: string;
  processing_started_at: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

type DbError = { code?: string; message?: string };

const UNIQUE_VIOLATION: DbError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "webhook_events_provider_event_id_key"',
};

export function createWebhookEventsMock() {
  const store = {
    rows: [] as WebhookEventRow[],
    insertError: null as DbError | null,
    selectError: null as DbError | null,
    updateError: null as DbError | null,
    seq: 0,

    reset() {
      store.rows = [];
      store.insertError = null;
      store.selectError = null;
      store.updateError = null;
      store.seq = 0;
    },

    /** Pre-existing row, e.g. an already-processed or in-flight event. */
    seed(overrides: Partial<WebhookEventRow> = {}) {
      const row: WebhookEventRow = {
        id: `evt_row_${++store.seq}`,
        provider: "telnyx",
        event_id: "evt_1",
        event_type: "message.received",
        business_id: "biz_1",
        signature_verified: true,
        created_at: new Date().toISOString(),
        processing_started_at: new Date().toISOString(),
        processed_at: null,
        processing_error: null,
        ...overrides,
      };
      store.rows.push(row);
      return row;
    },

    table() {
      return {
        insert(row: Record<string, unknown>) {
          if (store.insertError) return Promise.resolve({ error: store.insertError });
          const exists = store.rows.some(
            (r) => r.provider === row["provider"] && r.event_id === row["event_id"],
          );
          if (exists) return Promise.resolve({ error: UNIQUE_VIOLATION });
          store.seed({
            provider: String(row["provider"]),
            event_id: String(row["event_id"]),
            event_type: String(row["event_type"] ?? "unknown"),
            business_id: (row["business_id"] as string | null) ?? null,
            signature_verified: Boolean(row["signature_verified"]),
            processing_started_at: (row["processing_started_at"] as string | null) ?? null,
            processed_at: (row["processed_at"] as string | null) ?? null,
          });
          return Promise.resolve({ error: null });
        },

        select() {
          return makeQuery("read");
        },

        update(patch: Record<string, unknown>) {
          return makeQuery("update", patch);
        },
      };
    },
  };

  type Condition = (row: WebhookEventRow) => boolean;

  function makeQuery(mode: "read" | "update", patch: Record<string, unknown> = {}) {
    const conditions: Condition[] = [];
    let returning = false;

    function matches() {
      return store.rows.filter((row) => conditions.every((c) => c(row)));
    }

    function run() {
      if (mode === "read") {
        if (store.selectError) return { data: null, error: store.selectError };
        return { data: matches()[0] ?? null, error: null };
      }
      if (store.updateError) return { data: null, error: store.updateError };
      const affected = matches();
      for (const row of affected) Object.assign(row, patch);
      return { data: returning ? affected.map((r) => ({ id: r.id })) : null, error: null };
    }

    const query = {
      eq(column: string, value: unknown) {
        conditions.push((row) => (row as unknown as Record<string, unknown>)[column] === value);
        return query;
      },
      is(column: string, value: null) {
        conditions.push(
          (row) => ((row as unknown as Record<string, unknown>)[column] ?? null) === value,
        );
        return query;
      },
      /** Only the claim-staleness disjunction is used, so parse exactly that. */
      or(filter: string) {
        const clauses = filter.split(",");
        conditions.push((row) =>
          clauses.some((clause) => {
            const [column, op, operand] = clause.split(/\.(.+?)\./) as [string, string, string];
            const current = (row as unknown as Record<string, unknown>)[column] ?? null;
            if (op === "is") return current === null;
            if (op === "lt") return typeof current === "string" && current < operand;
            return false;
          }),
        );
        return query;
      },
      select() {
        returning = true;
        return query;
      },
      maybeSingle() {
        return Promise.resolve(run());
      },
      then<T>(resolve: (value: ReturnType<typeof run>) => T) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return query;
  }

  return store;
}
