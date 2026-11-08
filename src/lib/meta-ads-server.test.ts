import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal fake Supabase query builder (no network or database).
type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]>; single: boolean };
const calls: Call[] = [];
const BUSINESS = '33333333-3333-3333-3333-333333333333';
let accountRow: Record<string, unknown> | null = null;
let recentCampaign: string | null = null;

function respond(c: Call): { data: unknown; error: unknown } {
  if (c.table === 'meta_ad_accounts' && c.op === 'select') return { data: accountRow, error: null };
  if (c.table === 'leads' && c.op === 'select') return { data: recentCampaign ? [{ campaign_id: recentCampaign }] : [], error: null };
  return { data: null, error: null };
}
function builder(table: string) {
  const call: Call = { table, op: 'select', payload: null, filters: [], single: false };
  calls.push(call);
  const b: Record<string, unknown> = {};
  const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return b; };
  Object.assign(b, {
    select: chain(), insert: chain((p) => { call.op = 'insert'; call.payload = p; }), update: chain((p) => { call.op = 'update'; call.payload = p; }),
    upsert: chain((p) => { call.op = 'upsert'; call.payload = p; }), delete: chain(() => { call.op = 'delete'; }),
    eq: chain((k, v) => call.filters.push([String(k), v])), neq: chain(), in: chain(), not: chain(), or: chain(), gte: chain(), is: chain(), order: chain(), limit: chain(),
    maybeSingle: chain(() => { call.single = true; }), single: chain(() => { call.single = true; }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(res, rej),
  });
  return b;
}
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }));

const graphFetch = (routes: Record<string, unknown>) => vi.fn(async (input: URL | RequestInfo) => {
  const u = new URL(String(input));
  const key = u.pathname.replace(/^\/v\d+\.\d+\//, '') + (u.searchParams.get('after') ? `?after=${u.searchParams.get('after')}` : '');
  const body = routes[key];
  return body === undefined ? Response.json({ error: { code: 100 } }, { status: 400 }) : body instanceof Response ? body : Response.json(body);
});
const upserts = (table: string) => calls.filter((c) => c.table === table && c.op === 'upsert').map((c) => c.payload);

beforeEach(() => { calls.length = 0; accountRow = null; recentCampaign = null; vi.stubEnv('TENANT_AI_ENCRYPTION_SECRET', 'test-only-secret'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('ad access on connect', () => {
  it('stores the user token encrypted and picks the account running the lead campaigns', async () => {
    recentCampaign = '777';
    const fetcher = graphFetch({
      'me/adaccounts': { data: [{ account_id: '111', name: 'Old', currency: 'AUD', account_status: 1 }, { account_id: '222', name: 'Glocast', currency: 'AUD', account_status: 1 }] },
      '777': { account_id: '222' },
    });
    const { saveAdAccess } = await import('./meta-ads.server');
    expect(await saveAdAccess(BUSINESS, 'user-token-xyz', '2027-01-08T00:00:00.000Z', fetcher as typeof fetch)).toMatchObject({ id: '222', name: 'Glocast' });
    const row = upserts('meta_ad_accounts')[0] as Record<string, unknown>;
    expect(row).toMatchObject({ business_id: BUSINESS, ad_account_id: '222', token_expires_at: '2027-01-08T00:00:00.000Z' });
    expect(JSON.stringify(row)).not.toContain('user-token-xyz');
    const { decryptMetaToken } = await import('./meta-oauth.server');
    expect(decryptMetaToken(String(row['user_token_ciphertext']), `meta-user:${BUSINESS}`)).toBe('user-token-xyz');
  });
});

describe('daily spend sync', () => {
  async function connected() {
    const { encryptMetaToken } = await import('./meta-oauth.server');
    accountRow = { ad_account_id: '222', user_token_ciphertext: encryptMetaToken('user-token-xyz', `meta-user:${BUSINESS}`), last_spend_sync_at: '2026-11-08T00:00:00Z' };
  }
  it('reads every page of campaign spend and stores one row per campaign per day', async () => {
    await connected();
    const fetcher = graphFetch({
      'act_222/insights': { data: [{ campaign_id: 'c1', campaign_name: 'Bentley', date_start: '2026-11-07', spend: '12.50', actions: [{ action_type: 'lead', value: '2' }] }], paging: { next: 'x', cursors: { after: 'p2' } } },
      'act_222/insights?after=p2': { data: [{ campaign_id: 'c1', campaign_name: 'Bentley', date_start: '2026-11-08', spend: '7.5' }] },
    });
    const { syncAdSpend } = await import('./meta-ads.server');
    expect(await syncAdSpend(BUSINESS, fetcher as typeof fetch, new Date('2026-11-09T02:00:00Z'))).toEqual({ rows: 2 });
    expect(upserts('meta_ad_spend_daily')[0]).toEqual([
      expect.objectContaining({ campaign_id: 'c1', date: '2026-11-07', spend: 12.5, meta_leads: 2, ad_account_id: '222' }),
      expect.objectContaining({ campaign_id: 'c1', date: '2026-11-08', spend: 7.5, meta_leads: 0 }),
    ]);
    const first = new URL(String((fetcher.mock.calls[0] as unknown as [URL])[0]));
    expect(JSON.parse(first.searchParams.get('time_range') ?? '{}')).toEqual({ since: '2026-11-07', until: '2026-11-09' });
    expect(first.searchParams.get('level')).toBe('campaign');
    expect(String(first)).not.toContain('user-token-xyz');
  });
  it('records an expired token as a reconnect message', async () => {
    await connected();
    const fetcher = graphFetch({ 'act_222/insights': Response.json({ error: { code: 190 } }, { status: 400 }) });
    const { syncAdSpend } = await import('./meta-ads.server');
    await expect(syncAdSpend(BUSINESS, fetcher as typeof fetch)).rejects.toThrow('Reconnect Facebook');
    const update = calls.filter((c) => c.table === 'meta_ad_accounts' && c.op === 'update').at(-1)?.payload as Record<string, unknown>;
    expect(update['last_error']).toContain('Reconnect Facebook');
  });
  it('asks to reconnect when no ad access is stored', async () => {
    const { syncAdSpend } = await import('./meta-ads.server');
    await expect(syncAdSpend(BUSINESS, vi.fn() as unknown as typeof fetch)).rejects.toThrow('Reconnect Facebook to load ad spend');
  });
});
