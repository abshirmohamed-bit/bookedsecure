import { describe, it, expect, vi } from 'vitest';
import { DIRECT_META_ALLOWLIST as scope, DIRECT_META_ENABLED, DIRECT_META_SCHEDULE_ENABLED, assertDirectMetaScope, createDirectMetaTransport, isDirectMetaPreviewHost, type DirectMetaConfig } from './meta-direct.server';

// Synthetic credentials only; no environment or real Meta/lead calls.
const config: DirectMetaConfig = { token: 'mock-only', version: 'v25.0', preview: true, enabled: true, scheduleEnabled: true };
const now = new Date('2026-11-06T01:00:00Z');
const row = (id: string) => ({ id, created_time: '2026-11-05T20:00:00Z', field_data: [{ name: 'full_name', values: ['Mock enquiry'] }, { name: 'custom_question', values: ['Original answer'] }] });
function mockTransport(pages: unknown[] = []) {
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/me/permissions')) return Response.json({ data: [{ permission: 'leads_retrieval', status: 'granted' }] });
    if (path.endsWith('/leadgen_forms')) return Response.json({ data: [{ id: scope.formIds[0], name: 'Allowlisted form' }] });
    return Response.json(pages.shift());
  });
  return { fetcher, transport: createDirectMetaTransport(config, fetcher as typeof fetch) };
}
describe('restricted direct Meta import', () => {
  it('leaves both direct mode and the five-minute schedule disabled', () => {
    expect(DIRECT_META_ENABLED).toBe(false);
    expect(DIRECT_META_SCHEDULE_ENABLED).toBe(false);
  });
  it('rejects another tenant before network reads or ingestion', async () => {
    const { fetcher, transport } = mockTransport(); const apply = vi.fn();
    await expect(transport.importLeads({ businessId: 'other-tenant', lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('not available');
    expect(fetcher).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });
  it('blocks absent credentials, including inbound API keys', () => {
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, token: undefined })).toThrow('API key cannot read Facebook');
  });
  it('blocks production hosts', () => {
    expect(isDirectMetaPreviewHost('bookedsecure.com')).toBe(false);
    expect(isDirectMetaPreviewHost('bookedsecure.lovable.app')).toBe(false);
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, preview: false })).toThrow('unpublished preview');
  });
  it('blocks disabled imports and schedules independently', () => {
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, enabled: false }, true)).toThrow('disabled');
    expect(() => assertDirectMetaScope(scope.businessId, { ...config, scheduleEnabled: false }, true, true)).toThrow('automatic imports are disabled');
  });
  it('follows cursors, preserves answers, and deduplicates repeated lead IDs', async () => {
    const { transport, fetcher } = mockTransport([
      { data: [row('1')], paging: { next: 'https://untrusted.example/never-follow', cursors: { after: 'cursor-2' } } },
      { data: [row('1'), row('2')] },
    ]);
    const apply = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => ({ status: 'completed' }));
    const result = await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now });
    expect(result.received).toBe(2);
    expect(apply.mock.calls[0]?.[0].leads[0]).toMatchObject({ meta_lead_id: '1', page_id: scope.pageId, form_id: scope.formIds[0], field_data: row('1').field_data });
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true });
    const urls = fetcher.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.every((u) => u.hostname === 'graph.facebook.com')).toBe(true);
    expect(urls.at(-1)?.searchParams.get('after')).toBe('cursor-2');
    expect(urls.at(-1)?.searchParams.get('fields')).toBe('id,created_time,field_data');
    const filters = JSON.parse(urls.at(-1)?.searchParams.get('filtering') ?? '[]');
    expect(filters).toHaveLength(2);
    expect(filters[0].value).toBe(Math.floor(new Date('2026-10-30T01:00:00Z').getTime() / 1000) - 1);
  });
  it('completes a zero-lead run successfully', async () => {
    const { transport } = mockTransport([{ data: [] }]); const apply = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => ({ status: 'completed' }));
    expect((await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ leads: [], final: true });
  });
  it('does not accept a missing leads_retrieval grant', async () => {
    const fetcher = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => Response.json({ data: [{ permission: 'leads_retrieval', status: 'declined' }] }));
    await expect(createDirectMetaTransport(config, fetcher as typeof fetch).testAccess(scope.businessId, now)).rejects.toThrow('granted leads_retrieval');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses a Page response missing the allowlisted form', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => Response.json({ data: String(url).includes('permissions') ? [{ permission: 'leads_retrieval', status: 'granted' }] : [{ id: 'different-form' }] }));
    await expect(createDirectMetaTransport(config, fetcher as typeof fetch).testAccess(scope.businessId, now)).rejects.toThrow('Page/form is absent');
  });
  it('records partial transport failure without a success finalization or raw provider body', async () => {
    const { fetcher } = mockTransport();
    fetcher.mockImplementationOnce(async () => Response.json({ data: [{ permission: 'leads_retrieval', status: 'granted' }] }));
    fetcher.mockImplementationOnce(async () => Response.json({ data: [{ id: scope.formIds[0] }] }));
    fetcher.mockImplementationOnce(async () => Response.json({ data: [row('1')], paging: { next: 'unused', cursors: { after: '2' } } }));
    fetcher.mockImplementationOnce(async () => new Response('private provider detail', { status: 403 }));
    const apply = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => ({}));
    await expect(createDirectMetaTransport(config, fetcher as typeof fetch).importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('Meta access was refused (403)');
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true, error: expect.stringContaining('Meta access was refused') });
    expect(JSON.stringify(apply.mock.calls)).not.toContain('private provider detail');
  });
  it('rejects repeated pagination cursors without advancing checkpoints', async () => {
    const paging = { next: 'unused', cursors: { after: 'same' } };
    const { transport } = mockTransport([{ data: [row('1')], paging }, { data: [], paging }]); const apply = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => ({}));
    await expect(transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('pagination could not be completed');
    expect(apply.mock.calls.at(-1)?.[0].error).toContain('pagination');
  });
  it('enforces local date bounds even when Meta returns outside-range submissions', async () => {
    const { transport } = mockTransport([{ data: [{ ...row('1'), created_time: '2025-01-01T00:00:00Z' }] }]); const apply = vi.fn(async (_input: { leads: Array<Record<string, unknown>>; final?: boolean; error?: string }) => ({}));
    expect((await transport.importLeads({ businessId: scope.businessId, lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
  });
});