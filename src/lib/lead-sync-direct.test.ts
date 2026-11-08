import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A minimal fake of the Supabase query builder: records every call and answers
// from a small table of canned rows. No network or database is touched.
type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown, unknown?]>; single: boolean };
const calls: Call[] = [];
const BUSINESS = '11111111-1111-1111-1111-111111111111';
const directConn = { id: 'direct-conn', business_id: BUSINESS, provider: 'meta_direct', trigger_url: null, initial_lookback_days: 7, consecutive_failures: 2, next_check_at: null };

function respond(c: Call): { data: unknown; error: unknown } {
  const provider = c.filters.find(([k]) => k === 'provider')?.[1];
  if (c.table === 'lead_sync_connections' && c.op === 'select') {
    if (provider === 'meta_direct') return { data: [directConn], error: null };
    if (provider === 'make') return { data: [], error: null };
    return { data: { provider: 'meta_direct', business_id: BUSINESS }, error: null };
  }
  if (c.table === 'lead_sync_runs' && c.op === 'insert') return { data: { id: 'run-1' }, error: null };
  if (c.table === 'lead_sync_runs' && c.op === 'select') return { data: { id: 'run-1', business_id: BUSINESS, connection_id: 'direct-conn', status: 'running' }, error: null };
  if (c.op === 'select') return { data: c.single ? null : [], error: null };
  return { data: null, error: null };
}

function builder(table: string) {
  const call: Call = { table, op: 'select', payload: null, filters: [], single: false };
  calls.push(call);
  const b: Record<string, unknown> = {};
  const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return b; };
  Object.assign(b, {
    select: chain(() => { /* keeps the write op if one was set */ }),
    insert: chain((p) => { call.op = 'insert'; call.payload = p; }),
    update: chain((p) => { call.op = 'update'; call.payload = p; }),
    upsert: chain((p) => { call.op = 'upsert'; call.payload = p; }),
    eq: chain((k, v) => call.filters.push([String(k), v])),
    neq: chain((k, v) => call.filters.push([`!${String(k)}`, v])),
    in: chain((k, v) => call.filters.push([`in:${String(k)}`, v])),
    lt: chain((k, v) => call.filters.push([`lt:${String(k)}`, v])),
    not: chain(), or: chain(), limit: chain(), order: chain(),
    single: chain(() => { call.single = true; }), maybeSingle: chain(() => { call.single = true; }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(res, rej),
  });
  return b;
}

vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }));

const connUpdates = () => calls.filter((c) => c.table === 'lead_sync_connections' && c.op === 'update').map((c) => c.payload as Record<string, unknown>);

beforeEach(() => { calls.length = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('five-minute sweep with a direct Facebook connection', () => {
  it('selects direct connections separately from Make ones', async () => {
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', '');
    const { sweepScheduledSyncs } = await import('./lead-sync.server');
    await sweepScheduledSyncs();
    const selects = calls.filter((c) => c.table === 'lead_sync_connections' && c.op === 'select' && c.filters.some(([k]) => k === 'provider'));
    expect(selects.map((c) => c.filters.find(([k]) => k === 'provider')?.[1])).toEqual(['make', 'meta_direct']);
    expect(selects.every((c) => c.filters.some(([k, v]) => k === 'auto_sync_enabled' && v === true))).toBe(true);
  });

  it('records a missing token as a failed attempt, without starting a run', async () => {
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { sweepScheduledSyncs } = await import('./lead-sync.server');
    expect(await sweepScheduledSyncs()).toMatchObject({ started: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === 'lead_sync_runs' && c.op === 'insert')).toBe(false);
    expect(connUpdates().at(-1)).toMatchObject({ consecutive_failures: 3, status: 'error', last_error: expect.stringContaining('access token') });
  });

  it('pauses automatic checks after the maximum consecutive failures', async () => {
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', '');
    const prev = directConn.consecutive_failures; directConn.consecutive_failures = 4;
    try {
      const { sweepScheduledSyncs } = await import('./lead-sync.server');
      await sweepScheduledSyncs();
      expect(connUpdates().at(-1)?.['last_error']).toContain('paused');
    } finally { directConn.consecutive_failures = prev; }
  });

  it('imports directly, completes the run and resets the failure count', async () => {
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', 'mock-only');
    const fetcher = vi.fn(async () => Response.json({ data: [] })); vi.stubGlobal('fetch', fetcher);
    const before = Date.now();
    const { sweepScheduledSyncs } = await import('./lead-sync.server');
    expect(await sweepScheduledSyncs()).toMatchObject({ started: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const insert = calls.find((c) => c.table === 'lead_sync_runs' && c.op === 'insert');
    expect(insert?.payload).toMatchObject({ connection_id: 'direct-conn', trigger_kind: 'schedule', status: 'running' });
    const runFinal = calls.filter((c) => c.table === 'lead_sync_runs' && c.op === 'update').map((c) => c.payload as Record<string, unknown>).at(-1);
    expect(runFinal).toMatchObject({ status: 'completed' });
    const last = connUpdates().at(-1)!;
    expect(last['consecutive_failures']).toBe(0);
    expect(Date.parse(String(last['next_check_at'])) - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
  });
});
