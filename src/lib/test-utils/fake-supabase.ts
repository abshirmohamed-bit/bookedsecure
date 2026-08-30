// Minimal in-memory stand-in for the Supabase client, for tests only.
// Supports the narrow chain shapes used by the lead-deletion server module.

type Row = Record<string, any>;

type Filter = (row: Row) => boolean;

export type FakeDb = Record<string, Row[]>;

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private singleRow = false;
  private maybe = false;
  private wantsRows = true;
  private limitValue: number | null = null;
  private orderKey: string | null = null;
  private orderAsc = true;

  constructor(
    private db: FakeDb,
    private table: string,
    private log: { table: string; op: string }[],
  ) {}

  private get rows(): Row[] {
    return (this.db[this.table] ??= []);
  }

  select(_columns?: string) {
    if (this.mode === "select") this.wantsRows = true;
    else this.wantsRows = true;
    return this;
  }
  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    this.wantsRows = false;
    this.log.push({ table: this.table, op: "insert" });
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    this.wantsRows = false;
    this.log.push({ table: this.table, op: "update" });
    return this;
  }
  delete() {
    this.log.push({ table: this.table, op: "delete" });
    throw new Error("hard delete is not permitted");
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  not(column: string, _op: "is", _value: null) {
    this.filters.push((row) => (row[column] ?? null) !== null);
    return this;
  }
  in(column: string, values: unknown[]) {
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderKey = column;
    this.orderAsc = options?.ascending !== false;
    return this;
  }
  limit(value: number) {
    this.limitValue = value;
    return this;
  }
  maybeSingle() {
    this.maybe = true;
    return this;
  }
  single() {
    this.singleRow = true;
    return this;
  }
  private matching() {
    return this.rows.filter((row) => this.filters.every((filter) => filter(row)));
  }
  private run(): { data: any; error: any } {
    if (this.mode === "insert") {
      const inserted = { id: `id-${this.rows.length + 1}`, ...(this.payload ?? {}) };
      this.rows.push(inserted);
      return { data: this.singleRow || this.maybe ? inserted : [inserted], error: null };
    }
    if (this.mode === "update") {
      const affected = this.matching();
      for (const row of affected) Object.assign(row, this.payload ?? {});
      return { data: this.singleRow || this.maybe ? (affected[0] ?? null) : affected, error: null };
    }
    let result = this.matching();
    if (this.orderKey) {
      const key = this.orderKey;
      result = [...result].sort((a, b) =>
        this.orderAsc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])),
      );
    }
    if (this.limitValue !== null) result = result.slice(0, this.limitValue);
    if (this.singleRow || this.maybe) return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export function createFakeSupabase(db: FakeDb) {
  const log: { table: string; op: string }[] = [];
  return {
    db,
    writes: log,
    from(table: string) {
      return new Query(db, table, log) as any;
    },
  } as any;
}
