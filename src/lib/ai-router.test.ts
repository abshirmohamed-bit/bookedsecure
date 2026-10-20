import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canFailOver, normaliseRouting } from './ai-router';

const m = vi.hoisted(() => ({ routing: {} as Record<string, unknown>, paused: false, account: null as null | Record<string, unknown>, write: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  let id = '';
  const chain = { select: () => chain, eq: (_f: string, v: string) => { id = v; return chain; }, upsert: m.write,
    maybeSingle: async () => ({ data: table === 'ai_gateway_state' ? (id === 'routing' ? m.routing : { paused: m.paused }) : m.account, error: null }) };
  return chain;
} } }));
vi.mock('./tenant-ai-crypto.server', () => ({ decryptAiKey: () => 'k', encryptAiKey: vi.fn() }));
vi.mock('./tenant-ai-provider.server', () => ({ directAiProvider: () => ({ model: 'tenant' }), verifyAiAccount: vi.fn() }));
import { withAiBackup } from './tenant-ai.server';

beforeEach(() => {
  m.routing = { primary_provider: 'external', lovable_standby: true }; m.paused = false; m.account = null;
  m.write.mockResolvedValue({ error: null }); process.env['CHEAPER_INFERENCE_API_KEY'] = 'test';
});

describe('failover rules', () => {
  it('fails over for credits, rate limits, outages and network errors', () => {
    for (const s of [402, 429, 500, 503]) expect(canFailOver({ statusCode: s })).toBe(true);
    expect(canFailOver(new TypeError('fetch failed'))).toBe(true);
  });
  it('never fails over for denials or bad requests', () => {
    for (const s of [400, 401, 403, 404]) expect(canFailOver({ statusCode: s })).toBe(false);
    expect(canFailOver(new Error('refused'))).toBe(false);
  });
  it('defaults to Lovable primary with standby', () => {
    expect(normaliseRouting(null)).toMatchObject({ primary: 'lovable', lovableStandby: true });
  });
});

describe('external primary routing', () => {
  it('uses the external provider first and never calls Lovable on success', async () => {
    const gateway = vi.fn();
    expect(await withAiBackup({ businessId: 'a', gateway, backup: async () => 'external' })).toBe('external');
    expect(gateway).not.toHaveBeenCalled();
  });
  it('falls back to Lovable standby on an outage before tools ran', async () => {
    expect(await withAiBackup({ businessId: 'a', gateway: async () => 'lovable', backup: async () => { throw { statusCode: 503 }; } })).toBe('lovable');
  });
  it('does not replay once tools started', async () => {
    const gateway = vi.fn();
    await expect(withAiBackup({ businessId: 'a', gateway, canReplay: () => false, backup: async () => { throw { statusCode: 503 }; } })).rejects.toThrow('after work started');
    expect(gateway).not.toHaveBeenCalled();
  });
  it('does not switch provider for an access denial', async () => {
    const gateway = vi.fn();
    await expect(withAiBackup({ businessId: 'a', gateway, backup: async () => { throw { statusCode: 403 }; } })).rejects.toThrow();
    expect(gateway).not.toHaveBeenCalled();
  });
  it('skips Lovable entirely when it is turned off', async () => {
    m.routing = { primary_provider: 'external', lovable_standby: false };
    const gateway = vi.fn();
    await expect(withAiBackup({ businessId: 'a', gateway, backup: async () => { throw { statusCode: 503 }; } })).rejects.toThrow('backup AI');
    expect(gateway).not.toHaveBeenCalled();
  });
});
