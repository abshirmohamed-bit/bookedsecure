import { describe, it, expect, vi } from 'vitest';
import { LEAD_AD_FIELDS, createDirectMetaTransport, describeGraphFailure, type DirectMetaAccount } from './meta-direct.server';

// Synthetic credentials and ids only; no environment or real Meta/lead calls.
const account: DirectMetaAccount = { businessId: 'biz-a', pageId: '111', pageName: 'Mock Page', token: 'mock-only', formIds: [] };
const now = new Date('2026-11-06T01:00:00Z');
type Batch = { leads: Array<Record<string, unknown>>; final?: boolean; error?: string };
const row = (id: string) => ({ id, created_time: '2026-11-05T20:00:00Z', field_data: [{ name: 'full_name', values: ['Mock enquiry'] }, { name: 'custom_question', values: ['Original answer'] }] });
const FORMS = { data: [{ id: '501', name: 'Quote form', status: 'ACTIVE' }, { id: '502', name: 'Old form', status: 'ARCHIVED' }] };

/** Answers the Page's form list from `forms`, and each leads read from `pages` in order. */
function mockTransport(pages: unknown[] = [], acct: DirectMetaAccount = account, forms: unknown = FORMS) {
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    if (new URL(String(url)).pathname.endsWith('/leadgen_forms')) return Response.json(forms);
    return Response.json(pages.shift());
  });
  return { fetcher, transport: createDirectMetaTransport(acct, 'v27.0', fetcher as typeof fetch) };
}
const applyMock = () => vi.fn(async (_input: Batch) => ({ status: 'completed' }));
const leadUrls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname.endsWith('/leads'));

describe('direct Facebook import (per business)', () => {
  it('imports only active forms when no forms are selected', async () => {
    const { transport, fetcher } = mockTransport([{ data: [row('1')] }]);
    const apply = applyMock();
    await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now });
    expect(leadUrls(fetcher).map((u) => u.pathname)).toEqual(['/v27.0/501/leads']);
    expect(apply.mock.calls[0]?.[0].leads[0]).toMatchObject({ meta_lead_id: '1', page_id: '111', form_id: '501', form_name: 'Quote form', field_data: row('1').field_data });
  });
  it('imports exactly the selected forms, archived ones included', async () => {
    const { transport, fetcher } = mockTransport([{ data: [] }], { ...account, formIds: ['502'] });
    await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply: applyMock(), now });
    expect(leadUrls(fetcher).map((u) => u.pathname)).toEqual(['/v27.0/502/leads']);
  });
  it('refuses a selected form that is not on the connected Page', async () => {
    const { transport } = mockTransport([], { ...account, formIds: ['999'] });
    const apply = applyMock();
    await expect(transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('no longer on the connected Facebook Page');
    expect(apply.mock.calls.at(-1)?.[0]).toMatchObject({ final: true, error: expect.stringContaining('no longer') });
  });
  it('reads the form list from the business’s own Page', async () => {
    const { transport, fetcher } = mockTransport();
    expect(await transport.listForms()).toEqual([{ id: '501', name: 'Quote form', status: 'ACTIVE' }, { id: '502', name: 'Old form', status: 'ARCHIVED' }]);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/v27.0/111/leadgen_forms');
  });
  it('follows cursors and deduplicates repeated lead IDs', async () => {
    const { transport, fetcher } = mockTransport([
      { data: [row('1')], paging: { next: 'https://untrusted.example/never-follow', cursors: { after: 'cursor-2' } } },
      { data: [row('1'), row('2')] },
    ]);
    const apply = applyMock();
    expect((await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(2);
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true });
    const urls = fetcher.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.every((u) => u.hostname === 'graph.facebook.com')).toBe(true);
    const last = leadUrls(fetcher).at(-1)!;
    expect(last.searchParams.get('after')).toBe('cursor-2');
    expect(last.searchParams.get('fields')).toBe(`id,created_time,field_data,${LEAD_AD_FIELDS}`);
    const filters = JSON.parse(last.searchParams.get('filtering') ?? '[]');
    expect(filters[0].value).toBe(Math.floor(new Date('2026-10-30T01:00:00Z').getTime() / 1000) - 1);
  });
  it('sends the token only as a bearer header, never in the URL', async () => {
    const { transport, fetcher } = mockTransport([{ data: [] }]);
    await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply: applyMock(), now });
    for (const [url, init] of fetcher.mock.calls as unknown as Array<[URL, RequestInit]>) {
      expect(String(url)).not.toContain('mock-only');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-only');
    }
  });
  it('continues from the checkpoint, with the overlap window', async () => {
    const { transport, fetcher } = mockTransport([{ data: [] }]);
    await transport.importLeads({ lookbackDays: 7, checkpoints: [{ form_id: '501', last_submitted_at: '2026-11-06T00:30:00Z' }], apply: applyMock(), now });
    const filters = JSON.parse(leadUrls(fetcher)[0]!.searchParams.get('filtering') ?? '[]');
    expect(filters[0].value).toBe(Math.floor(new Date('2026-11-06T00:15:00Z').getTime() / 1000) - 1);
  });
  it('completes a zero-lead run successfully', async () => {
    const { transport } = mockTransport([{ data: [] }]); const apply = applyMock();
    expect((await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ leads: [], final: true });
  });
  it('tests access with one bounded read per form and saves nothing', async () => {
    const { transport, fetcher } = mockTransport([{ data: [row('9')] }]);
    await expect(transport.testAccess(now)).resolves.toMatchObject({ healthy: true, formCount: 1, pageName: 'Mock Page' });
    expect(leadUrls(fetcher)).toHaveLength(1);
    expect(leadUrls(fetcher)[0]!.searchParams.get('limit')).toBe('1');
  });
  it('reports a Page with no active forms', async () => {
    const { transport } = mockTransport([], account, { data: [{ id: '502', name: 'Old', status: 'ARCHIVED' }] });
    await expect(transport.testAccess(now)).rejects.toThrow('no active lead forms');
  });
  it('asks to reconnect on an expired token without echoing the provider body', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 190, message: 'private provider detail' } }, { status: 400 }));
    const err = await createDirectMetaTransport(account, 'v27.0', fetcher as typeof fetch).testAccess(now).catch((e: Error) => e);
    expect(String(err)).toContain('Reconnect Facebook');
    expect(String(err)).not.toContain('private provider detail');
  });
  it('maps Graph errors to controlled messages', () => {
    expect(describeGraphFailure(403, { error: { code: 200 } })).toContain('Leads Access');
    expect(describeGraphFailure(400, { error: { code: 17 } })).toContain('rate-limiting');
    expect(describeGraphFailure(400, { error: { code: 100 } })).toContain('lead form');
    expect(describeGraphFailure(500, 'not json')).toContain('(500)');
  });
  it('records partial transport failure without a success finalization or raw provider body', async () => {
    const { fetcher, transport } = mockTransport();
    fetcher.mockImplementationOnce(async () => Response.json(FORMS));
    fetcher.mockImplementationOnce(async () => Response.json({ data: [row('1')], paging: { next: 'unused', cursors: { after: '2' } } }));
    fetcher.mockImplementationOnce(async () => new Response('private provider detail', { status: 403 }));
    const apply = vi.fn(async (_input: Batch) => ({}));
    await expect(transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('Facebook refused access (403)');
    expect(apply.mock.calls.at(-1)?.[0]).toEqual({ leads: [], final: true, error: expect.stringContaining('Facebook refused access') });
    expect(JSON.stringify(apply.mock.calls)).not.toContain('private provider detail');
  });
  it('rejects repeated pagination cursors without advancing checkpoints', async () => {
    const paging = { next: 'unused', cursors: { after: 'same' } };
    const { transport } = mockTransport([{ data: [row('1')], paging }, { data: [], paging }]); const apply = vi.fn(async (_input: Batch) => ({}));
    await expect(transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).rejects.toThrow('pagination could not be completed');
    expect(apply.mock.calls.at(-1)?.[0].error).toContain('pagination');
  });
  it('enforces local date bounds even when Meta returns outside-range submissions', async () => {
    const { transport } = mockTransport([{ data: [{ ...row('1'), created_time: '2025-01-01T00:00:00Z' }] }]); const apply = vi.fn(async (_input: Batch) => ({}));
    expect((await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now })).received).toBe(0);
  });
  it('attaches the campaign, ad set and ad each lead came from', async () => {
    const { transport } = mockTransport([{ data: [{ ...row('1'), campaign_id: '77', campaign_name: 'High-income Bentley', adset_name: 'Sydney 25-55', ad_id: '88', ad_name: 'Bentley Interior $279', is_organic: false }] }]);
    const apply = applyMock();
    await transport.importLeads({ lookbackDays: 7, checkpoints: [], apply, now });
    expect(apply.mock.calls[0]?.[0].leads[0]?.['ad']).toEqual({ campaign_id: '77', campaign_name: 'High-income Bentley', adset_name: 'Sydney 25-55', ad_id: '88', ad_name: 'Bentley Interior $279', is_organic: false });
  });
  it('keeps importing without attribution when Facebook refuses the ad fields', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/leadgen_forms')) return Response.json(FORMS);
      if ((u.searchParams.get('fields') ?? '').includes('campaign_name')) return Response.json({ error: { code: 200 } }, { status: 403 });
      return Response.json({ data: [row('1')] });
    });
    const apply = applyMock();
    const result = await createDirectMetaTransport(account, 'v27.0', fetcher as typeof fetch).importLeads({ lookbackDays: 7, checkpoints: [], apply, now });
    expect(result.received).toBe(1);
    expect(apply.mock.calls[0]?.[0].leads[0]?.['ad']).toBeNull();
  });
});

