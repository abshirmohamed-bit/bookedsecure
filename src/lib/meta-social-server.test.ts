import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal fake Supabase query builder (no network or database).
type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]>; single: boolean };
const calls: Call[] = [];
const BIZ = '44444444-4444-4444-4444-444444444444';
let metaRow: Record<string, unknown> | null = null;
let commentRow: Record<string, unknown> | null = null;
let lastInbound: Record<string, unknown> | null = null;

function respond(c: Call): { data: unknown; error: unknown } {
  if (c.table === 'meta_lead_accounts' && c.op === 'select') return { data: metaRow, error: null };
  if (c.table === 'social_comments' && c.op === 'select') return { data: c.filters.some(([k]) => k === 'comment_id') ? null : commentRow, error: null };
  if (c.table === 'social_messages' && c.op === 'select') return { data: lastInbound, error: null };
  if (c.table === 'meta_social_state' && c.op === 'select') return { data: null, error: null };
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

const of = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op).map((c) => c.payload as Record<string, unknown>);

beforeEach(async () => {
  calls.length = 0; commentRow = null; lastInbound = null;
  vi.stubEnv('TENANT_AI_ENCRYPTION_SECRET', 'test-only-secret');
  vi.stubEnv('LOVABLE_API_KEY', '');
  const { encryptMetaToken, tokenContext } = await import('./meta-oauth.server');
  metaRow = { business_id: BIZ, page_id: '111', page_name: 'Mock Page', form_ids: [], token_ciphertext: encryptMetaToken('page-token', tokenContext(BIZ, '111')) };
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('posting an approved comment reply', () => {
  it('replies to a Facebook comment and marks it posted', async () => {
    commentRow = { id: 'row1', platform: 'facebook', comment_id: '555_777', approved_response: 'Thanks! Message us for a quote.', status: 'approved' };
    const fetcher = vi.fn(async () => Response.json({ id: '999' }));
    const { postCommentReply } = await import('./meta-social.server');
    expect(await postCommentReply(BIZ, 'row1', fetcher as typeof fetch)).toEqual({ posted: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(new URL(String(url)).pathname).toMatch(/\/555_777\/comments$/);
    expect(new URL(String(url)).searchParams.get('message')).toBe('Thanks! Message us for a quote.');
    expect(of('social_comments', 'update').at(-1)).toMatchObject({ status: 'posted' });
  });
  it('uses the replies edge on Instagram', async () => {
    commentRow = { id: 'row2', platform: 'instagram', comment_id: '1789', approved_response: 'Yes we do!', status: 'approved' };
    const fetcher = vi.fn(async () => Response.json({ id: '1' }));
    const { postCommentReply } = await import('./meta-social.server');
    await postCommentReply(BIZ, 'row2', fetcher as typeof fetch);
    expect(new URL(String((fetcher.mock.calls[0] as unknown as [URL])[0])).pathname).toMatch(/\/1789\/replies$/);
  });
  it('records a failed post without losing the approved text', async () => {
    commentRow = { id: 'row3', platform: 'facebook', comment_id: '1', approved_response: 'Hi', status: 'approved' };
    const fetcher = vi.fn(async () => Response.json({ error: { code: 200, message: 'secret provider detail' } }, { status: 403 }));
    const { postCommentReply } = await import('./meta-social.server');
    const r = await postCommentReply(BIZ, 'row3', fetcher as typeof fetch);
    expect(r.posted).toBe(false);
    const update = of('social_comments', 'update').at(-1)!;
    expect(update['status']).toBe('failed');
    expect(String(update['post_error'])).not.toContain('secret provider detail');
  });
  it('refuses to post anything that is not approved', async () => {
    commentRow = { id: 'row4', platform: 'facebook', comment_id: '1', approved_response: null, status: 'pending_review' };
    const fetcher = vi.fn();
    const { postCommentReply } = await import('./meta-social.server');
    expect((await postCommentReply(BIZ, 'row4', fetcher as unknown as typeof fetch)).posted).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('sending a DM reply', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('sends a normal response within 24 hours and records it', async () => {
    lastInbound = { thread_id: 't1', participant_name: 'Alex', sent_at: '2026-11-10T10:00:00Z' };
    const fetcher = vi.fn(async () => Response.json({ message_id: 'mid.1' }));
    const { sendSocialMessage } = await import('./meta-social.server');
    await sendSocialMessage(BIZ, 'user-1', 'facebook', 'psid9', 'Tuesday works!', fetcher as typeof fetch, now);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new URL(String(url)).pathname).toMatch(/\/111\/messages$/);
    expect(JSON.parse(String(init.body))).toEqual({ recipient: { id: 'psid9' }, messaging_type: 'RESPONSE', message: { text: 'Tuesday works!' } });
    expect(of('social_messages', 'insert').at(-1)).toMatchObject({ direction: 'out', status: 'sent', message_id: 'mid.1', sent_by: 'user-1' });
  });
  it('uses the human-agent tag between 1 and 7 days', async () => {
    lastInbound = { thread_id: 't1', participant_name: 'Alex', sent_at: '2026-11-07T12:00:00Z' };
    const fetcher = vi.fn(async () => Response.json({ message_id: 'mid.2' }));
    const { sendSocialMessage } = await import('./meta-social.server');
    await sendSocialMessage(BIZ, 'user-1', 'instagram', '178', 'Following up', fetcher as typeof fetch, now);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1].body))).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });
  it('refuses after 7 days without calling Facebook', async () => {
    lastInbound = { thread_id: 't1', participant_name: 'Alex', sent_at: '2026-11-01T12:00:00Z' };
    const fetcher = vi.fn();
    const { sendSocialMessage } = await import('./meta-social.server');
    await expect(sendSocialMessage(BIZ, 'user-1', 'facebook', 'psid9', 'Hi', fetcher as unknown as typeof fetch, now)).rejects.toThrow('more than 7 days');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('fetching comments and messages', () => {
  it('saves new customer comments and messages and records sync state', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const u = new URL(String(input));
      const p = u.pathname.replace(/^\/v\d+\.\d+\//, '');
      if (p === '111' ) return Response.json({ instagram_business_account: { id: '178', username: 'glocast' } });
      if (p === '111/feed') return Response.json({ data: [{ id: 'p1', message: 'Post', comments: { data: [
        { id: 'c1', message: 'Price for SUV?', created_time: new Date().toISOString(), from: { id: 'u1', name: 'Sam' } },
        { id: 'c2', message: 'Our reply', created_time: new Date().toISOString(), from: { id: '111', name: 'Page' } },
      ] } }] });
      if (p === '111/ads_posts') return Response.json({ error: { code: 200 } }, { status: 403 });
      if (p === '178/media') return Response.json({ data: [] });
      if (p === '111/conversations') return Response.json({ data: u.searchParams.get('platform') === 'messenger' ? [{ id: 't1', updated_time: new Date().toISOString(), participants: { data: [{ id: '111' }, { id: 'psid9', name: 'Alex' }] }, messages: { data: [{ id: 'm1', message: 'Hi there', created_time: new Date().toISOString(), from: { id: 'psid9' } }] } }] : [] });
      return Response.json({ error: { code: 100 } }, { status: 400 });
    });
    const { syncSocial } = await import('./meta-social.server');
    const r = await syncSocial(BIZ, { force: true, fetcher: fetcher as typeof fetch });
    expect(r).toMatchObject({ skipped: false, newComments: 1, newMessages: 1, instagram: true });
    expect(of('social_comments', 'insert')).toEqual([expect.objectContaining({ platform: 'facebook', comment_id: 'c1', author_name: 'Sam', status: 'pending_review' })]);
    expect(of('social_messages', 'upsert')[0]).toMatchObject({ platform: 'facebook', participant_id: 'psid9', direction: 'in', body: 'Hi there' });
    expect(of('meta_social_state', 'upsert')[0]).toMatchObject({ business_id: BIZ, ig_user_id: '178', last_error: null });
    for (const [url] of fetcher.mock.calls as unknown as Array<[URL]>) expect(String(url)).not.toContain('page-token');
  });
});
