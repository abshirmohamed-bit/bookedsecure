import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { executeSharedAction, prepareAssistantText, customerInput, serviceInput } from './assistant-shared-actions';

const leadId = '10000000-0000-4000-8000-000000000001';
const customer = { name: 'Test customer', mobile: '0412345678', email: null, suburb: null, address: null, vehicle: null, requestedService: null, notes: null };
function clientMock(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  const ops: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is', 'maybeSingle']) chain[name] = (...args: unknown[]) => { ops.push([name, ...args]); return chain; };
  chain['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { client: { rpc, from: vi.fn(() => chain) } as unknown as SupabaseClient<Database>, rpc, ops };
}
describe('actions shared by Cowork and MCP', () => {
  it('normalises customer mobiles and sends no caller-supplied identity to the atomic action', async () => {
    const { client, rpc } = clientMock({ data: { ok: true, id: leadId, name: customer.name }, error: null });
    await executeSharedAction(client, 'create_customer', customer);
    expect(rpc).toHaveBeenCalledWith('assistant_account_action', { p_action: 'create_customer', p_input: { ...customer, mobile: '+61412345678' } });
  });
  it('rejects attempts to inject another business before executing', async () => {
    const { client, rpc } = clientMock({ data: null, error: null });
    await expect(executeSharedAction(client, 'create_customer', { ...customer, business_id: 'another-business' })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves exact owner prices and null unchanged fields', async () => {
    const { client, rpc } = clientMock({ data: { ok: true, id: leadId, name: 'Detail' }, error: null });
    const input = { serviceId: leadId, name: null, price: 'from $229', durationMinutes: null, category: null, description: null, active: null };
    await executeSharedAction(client, 'upsert_service', input);
    expect(rpc).toHaveBeenCalledWith('assistant_account_action', { p_action: 'upsert_service', p_input: input });
  });
  it.each(['Only the business owner', 'Your trial or subscription has ended', 'That service does not belong to your business'])('does not report success when access or ownership fails: %s', async message => {
    const { client } = clientMock({ data: null, error: { message } });
    await expect(executeSharedAction(client, 'create_customer', customer)).rejects.toThrow(message);
  });
  it('rejects empty save results', async () => {
    const { client } = clientMock({ data: null, error: null });
    await expect(executeSharedAction(client, 'create_customer', customer)).rejects.toThrow('Nothing was saved');
  });
  it('checks active tenant ownership and returns a proposal without sending', async () => {
    const { client, ops, rpc } = clientMock({ data: { id: leadId, name: 'Sarah', mobile_number: '+61412345678', opted_out_at: null, sms_suppressed_at: null }, error: null });
    const proposal = await prepareAssistantText(client, 'caller-tenant', { leadId, message: '  Thanks Sarah  ' });
    expect(proposal).toMatchObject({ kind: 'send_text', leadId, message: 'Thanks Sarah' });
    expect(ops).toContainEqual(['eq', 'business_id', 'caller-tenant']);
    expect(ops).toContainEqual(['is', 'deleted_at', null]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ opted_out_at: '2026-10-21', sms_suppressed_at: null }, { opted_out_at: null, sms_suppressed_at: '2026-10-21' }])('blocks opted-out or suppressed customers', async flags => {
    const { client } = clientMock({ data: { id: leadId, name: 'Sarah', mobile_number: '+61412345678', ...flags }, error: null });
    await expect(prepareAssistantText(client, 'tenant', { leadId, message: 'Thanks Sarah' })).rejects.toThrow();
  });
  it('rejects inaccessible customers and propagates read failures', async () => {
    const missing = clientMock({ data: null, error: null });
    await expect(prepareAssistantText(missing.client, 'tenant', { leadId, message: 'Thanks' })).rejects.toThrow('not in this business');
    const failed = clientMock({ data: null, error: { message: 'Denied' } });
    await expect(prepareAssistantText(failed.client, 'tenant', { leadId, message: 'Thanks' })).rejects.toThrow('could not be read');
  });
  it('shares strict schemas and accepts neither user nor tenant identity', () => {
    expect(customerInput.safeParse({ ...customer, userId: 'other' }).success).toBe(false);
    expect(serviceInput.safeParse({ serviceId: null, name: 'Detail', price: null, durationMinutes: 1441, category: null, description: null, active: true }).success).toBe(false);
  });
});