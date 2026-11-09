import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const mocks = vi.hoisted(() => ({
  context: vi.fn(), from: vi.fn(), rpc: vi.fn(),
  calls: [] as Array<{ table: string; ops: Array<[string, ...unknown[]]> }>,
  results: {} as Record<string, { data: unknown; error: unknown; count?: number | null }>,
}));
vi.mock('@lovable.dev/mcp-js', () => ({ defineTool: (tool: unknown) => tool, ToolError: class extends Error {} }));
vi.mock('../supabase', () => ({ callerContext: mocks.context, jsonResult: (data: unknown) => data }));
import listComments from './list-social-comments';
import prepareComment from './prepare-social-comment-reply';
import dismissComment from './dismiss-social-comment';
import prepareMessage from './prepare-social-message-reply';
import conversations from './list-social-conversations';
import schedule from './set-lead-import-schedule';
import adPerformance from './facebook-ad-performance';
import today from './today-overview';

type Tool = { inputSchema: Record<string, z.ZodTypeAny>; handler: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> };
const asTool = (value: unknown) => value as Tool;

beforeEach(() => {
  vi.clearAllMocks(); mocks.calls = []; mocks.results = {};
  mocks.from.mockImplementation((table: string) => {
    const call = { table, ops: [] as Array<[string, ...unknown[]]> }; mocks.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'range', 'limit', 'gte']) chain[method] = (...args: unknown[]) => { call.ops.push([method, ...args]); return chain; };
    chain['then'] = (resolve: (result: unknown) => unknown) => Promise.resolve(mocks.results[table] ?? { data: [], error: null, count: 0 }).then(resolve);
    return chain;
  });
  mocks.context.mockResolvedValue({ businessId: 'caller-tenant', client: { from: mocks.from, rpc: mocks.rpc } });
});

describe('Facebook and Instagram comments', () => {
  it('reads only the caller’s comments and pages through them', async () => {
    mocks.results['social_comments'] = { data: [{ id: 'c1', platform: 'instagram', author_name: 'jess', comment_text: 'Price?', post_text: 'Before/after', commented_at: '2026-11-09T01:00:00Z', created_at: '2026-11-09T01:00:00Z', draft_response: 'Thanks Jess!', approved_response: null, status: 'pending_review', post_error: null, posted_at: null, comment_url: null, lead_id: null }], error: null, count: 3 };
    const result = await asTool(listComments).handler({ status: 'pending_review', limit: 1, offset: 0 }, {}) as { comments: Array<Record<string, unknown>>; next_offset: number | null };
    expect(mocks.calls[0]?.ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
    expect(result.next_offset).toBe(1);
    expect(result.comments[0]).toMatchObject({ comment_id: 'c1', suggested_reply: 'Thanks Jess!', status: 'pending_review' });
  });
  it('prepares a reply without posting it and never takes a business id', async () => {
    mocks.rpc.mockResolvedValue({ data: { saved: true }, error: null });
    const result = await asTool(prepareComment).handler({ comment_id: '11111111-1111-4111-8111-111111111111', reply: 'Thanks!', business_id: 'other' }, {});
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_prepare_social_comment_reply', { p_comment_id: '11111111-1111-4111-8111-111111111111', p_reply: 'Thanks!' });
    expect(result).toMatchObject({ saved: true, posted: false });
    expect(Object.keys(asTool(prepareComment).inputSchema)).toEqual(['comment_id', 'reply']);
  });
  it('reports the database refusal instead of success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only the business owner can change data through this connection.' } });
    await expect(asTool(dismissComment).handler({ comment_id: '11111111-1111-4111-8111-111111111111' }, {})).rejects.toThrow('Only the business owner');
  });
  it('limits public replies to 2000 characters', () => {
    expect(asTool(prepareComment).inputSchema['reply']?.safeParse('x'.repeat(2001)).success).toBe(false);
  });
});

describe('Facebook and Instagram DMs', () => {
  it('prepares a DM reply without sending it', async () => {
    mocks.rpc.mockResolvedValue({ data: { saved: true, sent: false }, error: null });
    const result = await asTool(prepareMessage).handler({ platform: 'facebook', participant_id: 'psid9', reply: 'Tuesday works' }, {});
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_prepare_social_message_reply', { p_platform: 'facebook', p_participant_id: 'psid9', p_reply: 'Tuesday works' });
    expect(result).toMatchObject({ saved: true, sent: false });
  });
  it('lists conversations through the caller-scoped function', async () => {
    mocks.rpc.mockResolvedValue({ data: { conversations: [], total: 0, next_offset: null }, error: null });
    await asTool(conversations).handler({ limit: 20, offset: 0 }, {});
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_social_conversations', { p_limit: 20, p_offset: 0 });
  });
});

describe('Facebook lead import schedule', () => {
  it('only sends the settings that change', async () => {
    mocks.rpc.mockResolvedValue({ data: { saved: true, auto_sync_enabled: true }, error: null });
    await asTool(schedule).handler({ auto_sync: true, lookback_days: null }, {});
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_set_lead_import_schedule', { p_auto_sync: true });
  });
  it('refuses a request that changes nothing', async () => {
    await expect(asTool(schedule).handler({ auto_sync: null, lookback_days: null }, {})).rejects.toThrow('five-minute');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('Facebook ad performance', () => {
  it('combines Meta spend with BookedSecure leads and completed jobs', async () => {
    mocks.rpc.mockResolvedValue({ data: { connected: true, account_name: 'Glocast', currency: 'AUD', rows: [{ campaign_id: 'cmp1', campaign_name: 'Booked Secure', date: '2026-11-08', spend: 100, meta_leads: 4 }] }, error: null });
    mocks.results['leads'] = { data: [{ id: 'l1', source_campaign: 'Booked Secure', campaign_id: 'cmp1' }, { id: 'l2', source_campaign: 'Booked Secure', campaign_id: 'cmp1' }], error: null };
    mocks.results['jobs'] = { data: [{ lead_id: 'l1', scheduled_at: '2026-11-10T00:00:00Z', completion_status: 'completed', completed_value: 280 }], error: null };
    const result = await asTool(adPerformance).handler({ days: 30 }, {}) as { total: Record<string, number>; ad_account_connected: boolean };
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_facebook_ad_spend', { p_days: 30 });
    expect(result.ad_account_connected).toBe(true);
    expect(result.total).toMatchObject({ spend: 100, leads: 2, completed: 1 });
    expect(mocks.calls.every((c) => c.ops.some((op) => op[0] === 'eq' && op[1] === 'business_id' && op[2] === 'caller-tenant'))).toBe(true);
  });
});

describe('today overview', () => {
  it('reports DMs as unknown, not zero, when they cannot be read', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    mocks.results['lead_inbox_rows'] = { data: [{ id: 'l1', name: 'George', service_intent: 'Full detail', conversation_last_message_at: null }], error: null, count: 1 };
    const result = await asTool(today).handler({}, {}) as { social_dms_waiting: number | null; leads_waiting_for_reply: { latest: unknown[] } };
    expect(result.social_dms_waiting).toBeNull();
    expect(result.leads_waiting_for_reply.latest).toHaveLength(1);
  });
});
