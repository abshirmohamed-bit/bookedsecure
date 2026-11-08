import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_GRAPH_VERSION, DIRECT_META_ALLOWLIST as scope, assertDirectMetaScope, createDirectMetaTransport, describeGraphFailure, readDirectMetaConfig, type DirectMetaConfig } from './meta-direct.server';

// Synthetic credentials only; no environment or real Meta/lead calls.
const config: DirectMetaConfig = { token: 'mock-only', version: 'v25.0' };
const now = new Date('2026-11-06T01:00:00Z');
type Batch = { leads: Array<Record<string, unknown>>; final?: boolean; error?: string };
const row = (id: string) => ({ id, created_time: '2026-11-05T20:00:00Z', field_data: [{ name: 'full_name', values: ['Mock enquiry'] }, { name: 'custom_question', values: ['Original answer'] }] });
function mockTransport(pages: unknown[] = []) {
  const fetcher = vi.fn(async (_url: URL | RequestInfo) => Response.json(pages.shift()));
  return { fetcher, transport: createDirectMetaTransport(config, fetcher as typeof fetch) };
}
const applyMock = () => vi.fn(async (_input: Batch) => ({ status: 'completed' }));

afterEach(() => { vi.unstubAllEnvs(); });

describe('direct Facebook import', () => {
  it('reads the token and version from server secrets, defaulting the version', () => {
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', '');
    vi.stubEnv('META_DIRECT_GRAPH_VERSION', '');
    expect(readDirectMetaConfig()).toEqual({ token: undefined, version: DEFAULT_GRAPH_VERSION });
    vi.stubEnv('META_DIRECT_GLOCAST_ACCESS_TOKEN', ' secret ');
    vi.stubEnv('META_DIRECT_GRAPH_VERSION', 'v24.0');
    expect(readDirectMetaConfig()).toEqual({ token: 'secret', version: 'v24.0' });
  });
  it('runs on any host, including the live site, once the token is configured', () => {
    expect(() => assertDirectMetaScope(scope.businessId, config)).not.toThrow();
  });
  it('rejects another tenant before network reads or ingestion', async () => {
    const { fetcher, transport } = mockTransport(); const apply = vi.fn();
    await expect(transport.importLeads({ businessId: 'other-tenant', lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('not available');
    await expect(transport.testAccess('other-tenant', now)).rejects.toThrow('not available');
    expect(fetcher).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });
  it('blocks a missing token, including inbound API keys, and a malformed version', () => {
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, token: undefined })).toThrow('API key cannot read Facebook');
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, version: '25' })).toThrow('v23.0');
  });
  it('follows cursors, preserves answers, and deduplicates repeated lead IDs', async () => {
    const { transport, fetcher } = mockTransport([
      { data: [row('1')], paging: { next: 'https://untrusted.example/never-follow', cursors: { after: 'cursor-2' } } },
      { data: [row('1'), row('2')] },
    ]);
    const apply = applyMock();
    const result = await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now });
    expect(result.received).toBe(2);
    expect(apply.mock.calls[0]?.[0].leads[0]).toMatchObject({ meta_lead_id: '1', page_id: scope.pageId, form_id: scope.formIds[0], form_name: scope.forms[scope.formIds[0]!], field_data: row('1').field_data });
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true });
    const urls = fetcher.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.every((u) => u.hostname === 'graph.facebook.com' && u.pathname.startsWith('/v25.0/'))).toBe(true);
    expect(urls.at(-1)?.searchParams.get('after')).toBe('cursor-2');
    expect(urls.at(-1)?.searchParams.get('fields')).toBe('id,created_time,field_data');
    const filters = JSON.parse(urls.at(-1)?.searchParams.get('filtering') ?? '[]');
    expect(filters).toHaveLength(2);
    expect(filters[0].value).toBe(Math.floor(new Date('2026-10-30T01:00:00Z').getTime() / 1000) - 1);
  });
  it('sends the token only as a bearer header, never in the URL', async () => {
    const { transport, fetcher } = mockTransport([{ data: [] }]);
    await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply: applyMock(), now });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).not.toContain('mock-only');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-only');
  });
  it('continues from the checkpoint, with the overlap window', async () => {
    const { transport, fetcher } = mockTransport([{ data: [] }]);
    await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [{ form_id: scope.formIds[0]!, last_submitted_at: '2026-11-06T00:30:00Z' }], apply: applyMock(), now });
    const filters = JSON.parse(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('filtering') ?? '[]');
    expect(filters[0].value).toBe(Math.floor(new Date('2026-11-06T00:15:00Z').getTime() / 1000) - 1);
  });
  it('completes a zero-lead run successfully', async () => {
    const { transport } = mockTransport([{ data: [] }]); const apply = applyMock();
    expect((await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ leads: [], final: true });
  });
  it('tests access with one bounded read per form and saves nothing', async () => {
    const { transport, fetcher } = mockTransport([{ data: [row('9')] }]);
    await expect(transport.testAccess(scope.businessId, now)).resolves.toMatchObject({ healthy: true, formCount: scope.formIds.length });
    expect(fetcher).toHaveBeenCalledTimes(scope.formIds.length);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('limit')).toBe('1');
  });
  it('explains an expired token without echoing the provider body', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 190, message: 'private provider detail' } }, { status: 400 }));
    const err = await createDirectMetaTransport(config, fetcher as typeof fetch).testAccess(scope.businessId, now).catch((e: Error) => e);
    expect(String(err)).toContain('expired or was revoked');
    expect(String(err)).not.toContain('private provider detail');
  });
  it('maps Graph errors to controlled messages', () => {
    expect(describeGraphFailure(403, { error: { code: 200 } })).toContain('leads_retrieval');
    expect(describeGraphFailure(400, { error: { code: 17 } })).toContain('rate-limiting');
    expect(describeGraphFailure(400, { error: { code: 100 } })).toContain('META_DIRECT_GRAPH_VERSION');
    expect(describeGraphFailure(500, 'not json')).toContain('(500)');
  });
  it('records partial transport failure without a success finalization or raw provider body', async () => {
    const { fetcher } = mockTransport();
    fetcher.mockImplementationOnce(async () => Response.json({ data: [row('1')], paging: { next: 'unused', cursors: { after: '2' } } }));
    fetcher.mockImplementationOnce(async () => new Response('private provider detail', { status: 403 }));
    const apply = vi.fn(async (_input: Batch) => ({}));
    await expect(createDirectMetaTransport(config, fetcher as typeof fetch).importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('Facebook refused access (403)');
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true, error: expect.stringContaining('Facebook refused access') });
    expect(JSON.stringify(apply.mock.calls)).not.toContain('private provider detail');
  });
  it('rejects repeated pagination cursors without advancing checkpoints', async () => {
    const paging = { next: 'unused', cursors: { after: 'same' } };
    const { transport } = mockTransport([{ data: [row('1')], paging }, { data: [], paging }]); const apply = vi.fn(async (_input: Batch) => ({}));
    await expect(transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('pagination could not be completed');
    expect(apply.mock.calls.at(-1)?.[0].error).toContain('pagination');
  });
  it('enforces local date bounds even when Meta returns outside-range submissions', async () => {
    const { transport } = mockTransport([{ data: [{ ...row('1'), created_time: '2025-01-01T00:00:00Z' }] }]); const apply = vi.fn(async (_input: Batch) => ({}));
    expect((await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
  });
});
