import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), calls: [] as Array<{ table: string; ops: Array<[string, ...unknown[]]> }>, results: {} as Record<string, { data: unknown; error: unknown; count: number | null }> }));
vi.mock('@lovable.dev/mcp-js', () => ({ defineTool: (tool: unknown) => tool, ToolError: class extends Error {} }));
vi.mock('../supabase', () => ({ callerContext: mocks.context, jsonResult: (data: unknown) => data }));
import leads from './list-leads';
import history from './customer-history';
import services from './list-services';
import snapshot from './business-snapshot';
import reports from './campaign-reports';
import settings from './business-settings';
type Tool = { inputSchema: Record<string, z.ZodTypeAny>; handler: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> };
const asTool = (value: unknown) => value as Tool;
beforeEach(() => {
  vi.clearAllMocks(); mocks.calls = []; mocks.results = {};
  mocks.from.mockImplementation((table: string) => {
    const call = { table, ops: [] as Array<[string, ...unknown[]]> }; mocks.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'range', 'limit', 'ilike', 'gte', 'maybeSingle']) chain[method] = (...args: unknown[]) => { call.ops.push([method, ...args]); return chain; };
    chain['then'] = (resolve: (result: unknown) => unknown) => Promise.resolve(mocks.results[table] ?? { data: [], error: null, count: 0 }).then(resolve);
    return chain;
  });
  mocks.context.mockResolvedValue({ businessId: 'caller-tenant', client: { from: mocks.from } });
});
describe('external assistant read permissions and paging', () => {
  it('returns customer contacts with a next page rather than silently truncating all customers', async () => {
    mocks.results['leads'] = { data: [{ id: 'a', name: 'Customer', email: 'customer@example.test', mobile_number: '+61400000000' }], count: 2, error: null };
    const result = await asTool(leads).handler({ limit: 1, offset: 0 }, {});
    expect(result).toEqual(expect.objectContaining({ total: 2, next_offset: 1 }));
    expect(mocks.calls[0]?.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
    expect(mocks.calls[0]?.ops).toContainEqual(['is', 'deleted_at', null]);
    expect(mocks.calls[0]?.ops).toContainEqual(['range', 0, 0]);
  });
  it('ends pagination at the last customer', async () => {
    mocks.results['leads'] = { data: [{ id: 'b' }], count: 2, error: null };
    expect(await asTool(leads).handler({ limit: 1, offset: 1 }, {})).toEqual(expect.objectContaining({ next_offset: null }));
  });
  it.each([services, reports])('scopes every catalog/report query to the caller and bounds each page', async tool => {
    await asTool(tool).handler({ offset: 50, limit: 25 }, {});
    expect(mocks.calls).toHaveLength(2);
    for (const call of mocks.calls) {
      expect(call.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
      expect(call.ops).toContainEqual(['range', 50, 74]);
    }
  });
  it('checks tenant ownership before reading customer history', async () => {
    mocks.results['leads'] = { data: null, error: null, count: null };
    await expect(asTool(history).handler({ lead_id: 'other-tenant-customer' }, {})).rejects.toThrow('not found in your business');
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0]?.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
  });
  it('bounds history queries and propagates read failures', async () => {
    mocks.results['leads'] = { data: { id: 'lead', notes: null }, error: null, count: null };
    mocks.results['messages'] = { data: null, error: { message: 'denied' }, count: null };
    await expect(asTool(history).handler({ lead_id: 'lead' }, {})).rejects.toThrow('could not be fully read');
    expect(mocks.calls.find(c => c.table === 'messages')?.ops).toContainEqual(['limit', 50]);
    expect(mocks.calls.find(c => c.table === 'jobs')?.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
  });
  it('reports exact business counts using caller-scoped reads', async () => {
    mocks.results['leads'] = { data: null, error: null, count: 120 };
    mocks.results['jobs'] = { data: null, error: null, count: 7 };
    mocks.results['email_campaigns'] = { data: null, error: null, count: 3 };
    expect(await asTool(snapshot).handler({}, {})).toEqual(expect.objectContaining({ customer_lead_records: 120, upcoming_bookings: 7, completed_jobs: 7, email_campaigns: 3 }));
    for (const call of mocks.calls) expect(call.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
  });
  it('does not turn a counts permission failure into zero customers', async () => {
    mocks.results['leads'] = { data: null, error: { message: 'denied' }, count: null };
    await expect(asTool(snapshot).handler({}, {})).rejects.toThrow('could not be read');
  });
  it('reads only caller business settings and never selects secrets', async () => {
    mocks.results['businesses'] = { data: { name: 'Caller business' }, count: null, error: null };
    await asTool(settings).handler({}, {});
    expect(mocks.calls[0]?.ops).toContainEqual(['eq', 'id', 'caller-tenant']);
    expect(mocks.calls[0]?.ops).toContainEqual(['select', 'name,timezone,website_url,phone_number,service_area,opening_hours,quote_mode,quote_form_active,automation_enabled']);
  });
  it.each([leads, history, services, snapshot, reports, settings])('accepts no caller identity in its schema', tool => {
    expect(asTool(tool).inputSchema).not.toHaveProperty('business_id');
    expect(asTool(tool).inputSchema).not.toHaveProperty('user_id');
  });
  it('rejects unbounded customer pages', () => {
    expect(asTool(leads).inputSchema['limit']?.safeParse(101).success).toBe(false);
    expect(asTool(leads).inputSchema['offset']?.safeParse(-1).success).toBe(false);
  });
});