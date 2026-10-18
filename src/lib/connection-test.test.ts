import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { checkChatGptConnection } from './connection-test';

const getUser = vi.fn();
const listGrants = vi.fn();
const from = vi.fn();
const calls: Array<[string, ...unknown[]]> = [];
const client = { auth: { getUser, oauth: { listGrants } }, from } as unknown as SupabaseClient<Database>;
let profile: { data: unknown; error: unknown };
let leads: { data: unknown; error: unknown; count: number | null };
beforeEach(() => {
  vi.resetAllMocks(); calls.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: 'signed-in-user' } }, error: null });
  listGrants.mockResolvedValue({ data: [{ client: { name: 'ChatGPT' } }], error: null });
  profile = { data: { business_id: 'current-business', active: true }, error: null };
  leads = { data: [{ id: 'customer', name: 'Alex' }], count: 12, error: null };
  from.mockImplementation((table: string) => {
    calls.push(['from', table]);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'is', 'order', 'range', 'maybeSingle']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'profiles' ? profile : leads).then(resolve);
    return chain;
  });
});
describe('guided ChatGPT connection readiness', () => {
  it('stops before grants and customer reads if sign-in cannot be verified', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await checkChatGptConnection(client)).stage).toBe('account');
    expect(listGrants).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it('requires ChatGPT approval rather than any assistant approval', async () => {
    listGrants.mockResolvedValue({ data: [{ client: { name: 'Claude' } }], error: null });
    expect((await checkChatGptConnection(client)).stage).toBe('authorization');
    expect(from).not.toHaveBeenCalled();
  });
  it('does not treat a grant-list failure as missing approval', async () => {
    listGrants.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    expect((await checkChatGptConnection(client)).stage).toBe('authorization');
    expect(from).not.toHaveBeenCalled();
  });
  it('checks the current profile and bounds undeleted customer reads to five rows in its business', async () => {
    const result = await checkChatGptConnection(client);
    expect(result).toMatchObject({ stage: 'ready', total: 12, customers: [{ id: 'customer', name: 'Alex' }] });
    expect(calls).toContainEqual(['eq', 'id', 'signed-in-user']);
    expect(calls).toContainEqual(['eq', 'business_id', 'current-business']);
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    expect(calls).toContainEqual(['range', 0, 4]);
    expect(calls).toContainEqual(['select', 'id,name', { count: 'exact' }]);
    expect(calls.filter(call => call[0] === 'from')).toEqual([['from', 'profiles'], ['from', 'leads']]);
  });
  it.each([{ active: false, business_id: 'current-business' }, { active: true, business_id: null }])('refuses inactive or missing business access', async data => {
    profile.data = data;
    expect((await checkChatGptConnection(client)).stage).toBe('customers');
    expect(from).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed customer read into an empty success', async () => {
    leads = { data: null, error: { message: 'permission denied' }, count: null };
    expect((await checkChatGptConnection(client)).stage).toBe('customers');
  });
  it('rejects missing exact counts', async () => {
    leads.count = null;
    expect((await checkChatGptConnection(client)).stage).toBe('customers');
  });
  it('accepts a genuinely empty successful lookup', async () => {
    leads = { data: [], error: null, count: 0 };
    expect(await checkChatGptConnection(client)).toMatchObject({ stage: 'ready', total: 0, customers: [] });
  });
  it('catches connectivity failures at the current stage', async () => {
    listGrants.mockRejectedValue(new Error('offline'));
    expect((await checkChatGptConnection(client)).stage).toBe('authorization');
    expect(from).not.toHaveBeenCalled();
  });
});