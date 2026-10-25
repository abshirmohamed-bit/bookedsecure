import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: mocks.from } }));
import { buildAssistantTools, type AssistantToolContext } from './assistant-tools.server';

const ctx: AssistantToolContext = {
  client: {} as AssistantToolContext['client'], businessId: 'test-business', userId: 'test-user',
  role: 'owner', timeZone: 'Australia/Sydney', record: vi.fn(), propose: vi.fn(), attachment: null,
};
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'or', 'order', 'limit', 'in', 'maybeSingle']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const options = { toolCallId: 'test', messages: [] };
describe('Cowork failed customer reads', () => {
  it('does not report a failed customer search as no matching customers', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: { message: 'Read failed' } }));
    const execute = buildAssistantTools(ctx).find_customers.execute;
    if (!execute) throw new Error('Missing search tool');
    await expect(execute({ query: 'Sam' }, options)).rejects.toThrow('Could not search customers');
  });
  it('does not report missing bookings after the bookings read fails', async () => {
    mocks.from.mockImplementation((table) => query(table === 'leads'
      ? { data: [{ id: 'sam', name: 'Sam' }], error: null }
      : { data: null, error: { message: 'Read failed' } }));
    const execute = buildAssistantTools(ctx).find_customers.execute;
    if (!execute) throw new Error('Missing search tool');
    await expect(execute({ query: 'Sam' }, options)).rejects.toThrow('Could not read customer bookings');
  });
  it('refuses incomplete customer history when any sibling query fails', async () => {
    mocks.from.mockImplementation((table) => query(table === 'leads'
      ? { data: { id: 'sam', name: 'Sam' }, error: null }
      : { data: null, error: { message: 'Read failed' } }));
    const execute = buildAssistantTools(ctx).customer_history.execute;
    if (!execute) throw new Error('Missing history tool');
    expect(await execute({ leadId: 'sam' }, options)).toMatchObject({ ok: false });
  });
});