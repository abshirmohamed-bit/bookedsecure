import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; method: string; args: unknown[] };

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  key: null as null | Record<string, unknown>,
  rows: {} as Record<string, unknown[]>,
  readError: null as null | { message: string },
}));

vi.mock('@/integrations/supabase/client.server', () => {
  const from = (table: string) => {
    const result = () => {
      if (table === 'api_keys') return { data: db.key, error: null };
      if (table === 'api_key_requests') return { data: null, error: null, count: 0 };
      if (db.readError) return { data: null, error: db.readError, count: null };
      return { data: db.rows[table] ?? [], error: null, count: (db.rows[table] ?? []).length };
    };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'not', 'gte', 'lte', 'or', 'order', 'range', 'insert', 'update', 'maybeSingle']) {
      builder[method] = (...args: unknown[]) => { db.calls.push({ table, method, args }); return builder; };
    }
    builder['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return builder;
  };
  return { supabaseAdmin: { from } };
});
vi.mock('./subscription.server', () => ({ requireActiveSubscription: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/lead-engine.server', () => ({ captureLead: vi.fn().mockResolvedValue({ leadId: 'new-lead', duplicate: false, acknowledgementSent: true }) }));

import { API_ACCESS_LEVELS, generateApiKey } from './api-keys';
import { listBookingsResponse, listCustomersResponse, listLeadsResponse } from './api-records.server';
import { Route as LeadsRoute } from '@/routes/api/public/v1/leads';

const BASE = 'https://bookedsecure.com/api/public/v1';
const apiKey = generateApiKey();
const get = (path: string, key: string | null = apiKey) => new Request(`${BASE}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const useKey = (scopes: readonly string[], extra: Record<string, unknown> = {}) => { db.key = { id: 'key-1', business_id: 'biz-1', scopes: [...scopes], revoked_at: null, request_count: 0, ...extra }; };
const readsOf = (table: string, method: string): Call[] => db.calls.filter((c) => c.table === table && c.method === method);
const routes = [
  ['leads', listLeadsResponse, '/leads'],
  ['customers', listCustomersResponse, '/customers'],
  ['bookings', listBookingsResponse, '/bookings'],
] as const;

const leadRow = { id: 'l1', name: 'Sam Lee', mobile_number: '0412345678', email: 'sam@example.com', suburb: 'Auburn', service_address: '1 Main St', vehicle_type: 'SUV', service_intent: 'Full detail', main_concerns: 'Dog hair', status: 'new', booking_status: 'none', quote_status: 'none', consent_status: 'granted', opted_out_at: null, source_channel: 'meta', source_campaign: 'Spring', source_form: 'Form A', utm_source: 'Zapier', first_reply_at: null, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' };

beforeEach(() => {
  db.calls = [];
  db.readError = null;
  db.rows = {
    leads: [leadRow],
    jobs: [{ id: 'j1', lead_id: 'l1', scheduled_at: '2026-11-20T01:00:00.000Z', service_performed: 'Full detail', completion_status: 'scheduled', leads: { name: 'Sam Lee' } }],
  };
  useKey(API_ACCESS_LEVELS.read_write);
});

describe.each(routes)('GET %s: authentication and scope', (_name, handler, path) => {
  it('refuses a request with no key', async () => {
    const res = await handler(get(path, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'invalid_api_key' } });
  });
  it('refuses an unknown key', async () => {
    db.key = null;
    expect((await handler(get(path))).status).toBe(401);
  });
  it('refuses a revoked key', async () => {
    useKey(API_ACCESS_LEVELS.read_write, { revoked_at: '2026-11-01T00:00:00.000Z' });
    expect((await handler(get(path))).status).toBe(401);
  });
  it('refuses an add-leads-only key and reads nothing', async () => {
    useKey(API_ACCESS_LEVELS.leads_only);
    const res = await handler(get(path));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'insufficient_scope' } });
    expect(readsOf('leads', 'select')).toEqual([]);
    expect(readsOf('jobs', 'select')).toEqual([]);
  });
  it('only reads the key\'s own business', async () => {
    expect((await handler(get(path))).status).toBe(200);
    const table = path === '/bookings' ? 'jobs' : 'leads';
    expect(readsOf(table, 'eq')).toContainEqual(expect.objectContaining({ args: ['business_id', 'biz-1'] }));
  });
  it('reports a read failure instead of an empty list', async () => {
    db.readError = { message: 'boom' };
    const res = await handler(get(path));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'server_error' } });
  });
  it('refuses a bad date or status', async () => {
    expect((await handler(get(`${path}?from=nonsense`))).status).toBe(400);
    expect((await handler(get(`${path}?status=nonsense`))).status).toBe(400);
  });
});

describe('response shapes', () => {
  it('leads', async () => {
    const res = await listLeadsResponse(get('/leads'));
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: true, total: 1, limit: 25, offset: 0,
      leads: [{ id: 'l1', name: 'Sam Lee', mobile: '0412345678', email: 'sam@example.com', suburb: 'Auburn', address: '1 Main St', vehicle: 'SUV', service: 'Full detail', message: 'Dog hair', status: 'new', booking_status: 'none', quote_status: 'none', consent_status: 'granted', opted_out_at: null, source: 'meta', source_detail: 'Zapier', campaign: 'Spring', form_name: 'Form A', first_reply_at: null, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' }],
    });
    expect(String(readsOf('leads', 'select')[0]?.args[0])).not.toContain('public_token');
  });
  it('customers keep their existing shape', async () => {
    db.rows['leads'] = [{ id: 'l1', name: 'Sam Lee', mobile_number: '0412345678', email: null, suburb: 'Auburn', status: 'new', source_channel: 'meta', created_at: '2026-11-10T00:00:00.000Z' }];
    expect(await (await listCustomersResponse(get('/customers'))).json()).toEqual({
      ok: true, total: 1, limit: 25, offset: 0,
      customers: [{ id: 'l1', name: 'Sam Lee', mobile: '0412345678', email: null, suburb: 'Auburn', status: 'new', source_channel: 'meta', created_at: '2026-11-10T00:00:00.000Z' }],
    });
  });
  it('bookings keep their existing shape', async () => {
    expect(await (await listBookingsResponse(get('/bookings'))).json()).toEqual({
      ok: true, total: 1, limit: 25, offset: 0,
      bookings: [{ id: 'j1', customer_id: 'l1', customer_name: 'Sam Lee', scheduled_at: '2026-11-20T01:00:00.000Z', service: 'Full detail', status: 'scheduled' }],
    });
  });
});

describe('filters', () => {
  it('leads hide deleted records and apply status, dates and paging', async () => {
    await listLeadsResponse(get('/leads?status=new&from=2026-11-01&to=2026-11-10&limit=500&offset=10'));
    expect(readsOf('leads', 'is')).toContainEqual(expect.objectContaining({ args: ['deleted_at', null] }));
    expect(readsOf('leads', 'eq')).toContainEqual(expect.objectContaining({ args: ['status', 'new'] }));
    expect(readsOf('leads', 'gte')[0]?.args).toEqual(['created_at', '2026-11-01T00:00:00.000Z']);
    expect(readsOf('leads', 'lte')[0]?.args).toEqual(['created_at', '2026-11-10T23:59:59.999Z']);
    expect(readsOf('leads', 'range')[0]?.args).toEqual([10, 109]);
  });
  it('bookings default to upcoming and accept an earlier from and a status', async () => {
    const before = Date.now();
    await listBookingsResponse(get('/bookings'));
    expect(Date.parse(String(readsOf('jobs', 'gte')[0]?.args[1]))).toBeGreaterThanOrEqual(before);
    db.calls = [];
    await listBookingsResponse(get('/bookings?from=2026-01-01&status=completed'));
    expect(readsOf('jobs', 'gte')[0]?.args).toEqual(['scheduled_at', '2026-01-01T00:00:00.000Z']);
    expect(readsOf('jobs', 'eq')).toContainEqual(expect.objectContaining({ args: ['completion_status', 'completed'] }));
  });
});

describe('adding leads is unchanged', () => {
  const handlers = (LeadsRoute.options as unknown as { server: { handlers: Record<string, (ctx: { request: Request }) => Promise<Response>> } }).server.handlers;
  const post = (body: unknown) => new Request(`${BASE}/leads`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('an add-leads-only key can still POST but cannot GET', async () => {
    useKey(API_ACCESS_LEVELS.leads_only);
    const created = await handlers['POST']!({ request: post({ name: 'Sam Lee', mobile: '0412345678' }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ok: true, lead_id: 'new-lead', duplicate: false, acknowledgement_sent: true });
    expect((await handlers['GET']!({ request: get('/leads') })).status).toBe(403);
  });
  it('a read-only key cannot POST', async () => {
    useKey(['records:read']);
    expect((await handlers['POST']!({ request: post({ name: 'Sam Lee', mobile: '0412345678' }) })).status).toBe(403);
  });
});
