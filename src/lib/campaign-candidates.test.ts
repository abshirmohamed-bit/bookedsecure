import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: mocks.from } }));
import { loadReactivationCandidates } from './reactivation.server';

function page(result: unknown, ranges: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'order', 'in']) chain[method] = () => chain;
  chain['range'] = (start: number, end: number) => { ranges.push([start, end]); return chain; };
  chain['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
describe('campaign candidate records', () => {
  it('loads contacted customers and excludes opted-out records for all audiences', async () => {
    const ranges: unknown[] = [];
    mocks.from.mockImplementation(() => page({ data: [
      { id: 'contacted', name: 'Sam', mobile_number: '+61412345678', status: 'contacted' },
      { id: 'opted-out', mobile_number: '+61412345679', status: 'scheduled', opted_out_at: '2026-10-11' },
    ], error: null }, ranges));
    const result = await loadReactivationCandidates('tenant', { kind: 'all' });
    expect(result.candidates.map(row => row.leadId)).toEqual(['contacted']);
    expect(result.excluded).toBe(1);
    expect(mocks.from).toHaveBeenCalledWith('leads');
  });
  it('walks pages instead of silently truncating an all-customers campaign', async () => {
    const ranges: unknown[] = [];
    let calls = 0;
    mocks.from.mockImplementation(() => page({ data: calls++ === 0
      ? Array.from({ length: 500 }, (_, i) => ({ id: `lead-${i}`, mobile_number: '+61412345678' }))
      : [{ id: 'last', mobile_number: '+61412345679' }], error: null }, ranges));
    const result = await loadReactivationCandidates('tenant', { kind: 'all' });
    expect(result.candidates).toHaveLength(501);
    expect(ranges).toEqual([[0, 499], [500, 999]]);
  });
  it('propagates failed customer reads rather than claiming there are no eligible recipients', async () => {
    mocks.from.mockImplementation(() => page({ data: null, error: { message: 'Read failed' } }, []));
    await expect(loadReactivationCandidates('tenant', { kind: 'all' })).rejects.toThrow('Could not read campaign customers');
  });
});