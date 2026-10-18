import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ paused: false, account: null as null | Record<string, unknown>, calls: [] as Array<{ table: string; tenant?: string }>, write: vi.fn(), decrypt: vi.fn(), direct: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  const call = { table, tenant: undefined as string | undefined }; mocks.calls.push(call);
  const chain = { select: () => chain, eq: (_field: string, tenant: string) => { call.tenant = tenant; return chain; }, maybeSingle: async () => ({ data: table === 'ai_gateway_state' ? { paused: mocks.paused } : mocks.account, error: null }), upsert: mocks.write };
  return chain;
} } }));
vi.mock('./tenant-ai-crypto.server', () => ({ decryptAiKey: mocks.decrypt, encryptAiKey: vi.fn() }));
vi.mock('./tenant-ai-provider.server', () => ({ directAiProvider: mocks.direct, verifyAiAccount: vi.fn() }));
import { withAiBackup, loadAiAccount } from './tenant-ai.server';
beforeEach(() => {
  vi.clearAllMocks(); mocks.paused = false; mocks.account = { provider: 'openai', model: 'test-model', enabled: true, key_ciphertext: 'synthetic-ciphertext' }; mocks.calls = [];
  mocks.write.mockResolvedValue({ error: null }); mocks.decrypt.mockReturnValue('synthetic-test-value'); mocks.direct.mockReturnValue({ model: 'test-adapter' });
});
describe('backup-only provider routing', () => {
  it('uses Lovable first without loading a tenant credential', async () => {
    const backup = vi.fn();
    expect(await withAiBackup({ businessId: 'tenant-a', gateway: async () => 'primary', backup })).toBe('primary');
    expect(backup).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('pauses after 402 and uses only the requesting tenant account', async () => {
    const backup = vi.fn().mockResolvedValue('backup');
    expect(await withAiBackup({ businessId: 'tenant-a', gateway: async () => { throw { statusCode: 402 }; }, backup })).toBe('backup');
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ id: 'lovable', paused: true, reason: 'credits_exhausted' }));
    expect(mocks.calls.find(c => c.table === 'tenant_ai_accounts')?.tenant).toBe('tenant-a');
    expect(mocks.decrypt).toHaveBeenCalledWith('synthetic-ciphertext', 'tenant-a:openai:test-model');
  });
  it('does not replay actions when tools have started', async () => {
    const backup = vi.fn();
    await expect(withAiBackup({ businessId: 'tenant-a', gateway: async () => { throw { statusCode: 402 }; }, backup, canReplay: () => false })).rejects.toThrow('after work started');
    expect(backup).not.toHaveBeenCalled();
  });
  it('never probes Lovable on subsequent requests while credit-paused', async () => {
    mocks.paused = true; const gateway = vi.fn();
    await withAiBackup({ businessId: 'tenant-a', gateway, backup: async () => 'backup' });
    expect(gateway).not.toHaveBeenCalled();
  });
  it('does not switch for policy denials', async () => {
    const backup = vi.fn();
    await expect(withAiBackup({ businessId: 'tenant-a', gateway: async () => { throw { statusCode: 403 }; }, backup })).rejects.toEqual({ statusCode: 403 });
    expect(backup).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('stops safely when this tenant has no backup', async () => {
    mocks.paused = true; mocks.account = null;
    await expect(withAiBackup({ businessId: 'tenant-a', gateway: vi.fn(), backup: vi.fn() })).rejects.toThrow('Connect a backup');
  });
  it('does not return disabled credentials', async () => {
    mocks.account = { enabled: false };
    expect(await loadAiAccount('tenant-a')).toBeNull(); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('does not leak a provider exception', async () => {
    mocks.paused = true;
    await expect(withAiBackup({ businessId: 'tenant-a', gateway: vi.fn(), backup: async () => { throw new Error('unsafe provider diagnostics'); } })).rejects.toThrow('Your backup AI could not finish');
  });
});