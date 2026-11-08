import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEBHOOK_VERIFY_TOKEN, parseLeadgenEvents, validSignature, verifySubscription } from './meta-webhook.server';
import { LEAD_AD_FIELDS, createDirectMetaTransport, type DirectMetaAccount } from './meta-direct.server';

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const event = (leadgenId: string, pageId = '111') => ({ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: '501', created_time: 1794140000 } });

describe('Facebook webhook security', () => {
  it('answers the subscription check only for our verify token', () => {
    const ok = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': DEFAULT_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': '1158201444' });
    expect(verifySubscription(ok)).toBe('1158201444');
    expect(verifySubscription(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }))).toBeNull();
    expect(verifySubscription(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': DEFAULT_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': '<script>' }))).toBeNull();
  });
  it('accepts only bodies signed with the app secret', () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    expect(validSignature(body, sign(body, 'app-secret'), 'app-secret')).toBe(true);
    expect(validSignature(body, sign(body, 'other'), 'app-secret')).toBe(false);
    expect(validSignature(`${body} `, sign(body, 'app-secret'), 'app-secret')).toBe(false);
    expect(validSignature(body, null, 'app-secret')).toBe(false);
    expect(validSignature(body, sign(body, 'app-secret'), undefined)).toBe(false);
    expect(validSignature(body, 'sha256=zz', 'app-secret')).toBe(false);
  });
});

describe('Facebook webhook events', () => {
  it('extracts each new lead once, with its Page', () => {
    const body = { object: 'page', entry: [{ id: '111', changes: [event('900'), event('900'), event('901'), { field: 'feed', value: {} }] }] };
    expect(parseLeadgenEvents(body)).toEqual([{ pageId: '111', leadgenId: '900' }, { pageId: '111', leadgenId: '901' }]);
  });
  it('ignores other objects and malformed ids', () => {
    expect(parseLeadgenEvents({ object: 'user', entry: [{ changes: [event('900')] }] })).toEqual([]);
    expect(parseLeadgenEvents({ object: 'page', entry: [{ changes: [event('abc'), event('901', '../x')] }] })).toEqual([]);
    expect(parseLeadgenEvents('nonsense')).toEqual([]);
  });
  it('caps how many leads one delivery can trigger', () => {
    const changes = Array.from({ length: 40 }, (_, i) => event(String(1000 + i)));
    expect(parseLeadgenEvents({ object: 'page', entry: [{ changes }] })).toHaveLength(25);
  });
});

describe('single-lead read and Page subscription', () => {
  const account: DirectMetaAccount = { businessId: 'b', pageId: '111', pageName: 'P', token: 'mock-only', formIds: [] };
  it('reads one announced lead with its form and answers', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: '900', created_time: '2026-11-09T01:00:00+0000', form_id: '501', field_data: [{ name: 'full_name', values: ['A B'] }] }));
    const lead = await createDirectMetaTransport(account, 'v27.0', fetcher as typeof fetch).readLead('900');
    expect(lead).toMatchObject({ meta_lead_id: '900', form_id: '501', page_id: '111' });
    const url = new URL(String((fetcher.mock.calls[0] as unknown as [URL])[0]));
    expect(url.pathname).toBe('/v27.0/900');
    expect(url.searchParams.get('fields')).toBe(`id,created_time,form_id,field_data,${LEAD_AD_FIELDS}`);
  });
  it('refuses an invalid lead id without calling Facebook', async () => {
    const fetcher = vi.fn();
    await expect(createDirectMetaTransport(account, 'v27.0', fetcher as typeof fetch).readLead('../me')).rejects.toThrow('invalid lead id');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('subscribes the Page to leadgen and reads the subscription back', async () => {
    const fetcher = vi.fn(async (_u: URL | RequestInfo, init?: RequestInit) => Response.json(init?.method === 'POST' ? { success: true } : { data: [{ id: 'app-1', subscribed_fields: ['leadgen'] }] }));
    const t = createDirectMetaTransport(account, 'v27.0', fetcher as typeof fetch);
    await t.subscribeInstantLeads();
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(new URL(String(url)).pathname).toBe('/v27.0/111/subscribed_apps');
    expect(new URL(String(url)).searchParams.get('subscribed_fields')).toBe('leadgen');
    expect(await t.instantLeadsOn('app-1')).toBe(true);
    expect(await t.instantLeadsOn('app-2')).toBe(false);
  });
});
