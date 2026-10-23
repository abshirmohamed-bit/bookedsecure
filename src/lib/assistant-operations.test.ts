import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { executeAssistantOperation } from './assistant-operations';
import { operationInputs } from './assistant-operation-contracts';
const id = '10000000-0000-4000-8000-000000000001';
const customer = { leadId: id, name: 'Customer', mobile: '0412345678', email: null, suburb: null, address: null, vehicle: null, requestedService: null, notes: null, status: null, clearOptOut: null };
function mock(result = { data: { ok: true }, error: null } as { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const ops: unknown[] = [];
  const from = vi.fn((table: string) => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn((...args: unknown[]) => { ops.push(args); return chain; }), single: vi.fn().mockResolvedValue({ data: table === 'profiles' ? { business_id: 'caller-business' } : { timezone: 'Australia/Sydney' }, error: null }) };
    return chain;
  });
  return { client: { rpc, from, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null }) } } as unknown as SupabaseClient<Database>, rpc, ops };
}
describe('shared operational actions', () => {
  it('normalises customer mobile and does not pass tenant identity', async () => {
    const { client, rpc } = mock();
    await executeAssistantOperation(client, 'update_customer', customer);
    expect(rpc).toHaveBeenCalledWith('assistant_operational_action', { p_action: 'update_customer', p_input: { ...customer, mobile: '+61412345678' } });
  });
  it('rejects another tenant injected into arguments before saving', async () => {
    const { client, rpc } = mock();
    await expect(executeAssistantOperation(client, 'update_customer', { ...customer, businessId: 'other' })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('books 9am Sydney in daylight saving using the verified owner profile', async () => {
    const { client, rpc, ops } = mock();
    await executeAssistantOperation(client, 'book_job', { leadId: id, date: '2026-10-24', time: '09:00', serviceName: null, notes: null });
    expect(ops).toContainEqual(['id', 'verified-user']);
    expect(rpc).toHaveBeenCalledWith('assistant_operational_action', { p_action: 'book_job', p_input: { leadId: id, date: '2026-10-24', time: '09:00', startsAt: '2026-10-23T22:00:00.000Z', serviceName: null, notes: null } });
  });
  it('does not report a failed save as success', async () => {
    const { client } = mock({ data: null, error: { message: 'That time is already booked.' } });
    await expect(executeAssistantOperation(client, 'update_customer', customer)).rejects.toThrow('already booked');
  });
  it('preserves false pause states and zero follow-up delays', async () => {
    const { client, rpc } = mock();
    await executeAssistantOperation(client, 'update_follow_up_rule', { ruleId: id, delayMinutes: 0, messageTemplate: null, active: false });
    expect(rpc).toHaveBeenCalledWith('assistant_operational_action', { p_action: 'update_follow_up_rule', p_input: { ruleId: id, delayMinutes: 0, messageTemplate: null, active: false } });
  });
  it('accepts the exact stated completion amount', async () => {
    const { client, rpc } = mock();
    await executeAssistantOperation(client, 'complete_job', { leadId: id, jobId: null, paidAmount: 450, serviceName: null });
    expect(rpc).toHaveBeenCalledWith('assistant_operational_action', { p_action: 'complete_job', p_input: { leadId: id, jobId: null, paidAmount: 450, serviceName: null } });
  });
  it('does not accept a sending or confirmed flag on customer updates', () => {
    expect(operationInputs.update_customer.safeParse({ ...customer, confirmed: true, send: true }).success).toBe(false);
  });
});