import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptAiKey, decryptAiKey } from './tenant-ai-crypto.server';
afterEach(() => vi.unstubAllEnvs());
describe('tenant AI credential isolation', () => {
  it('decrypts only within the original tenant/provider/model context', () => {
    vi.stubEnv('TENANT_AI_ENCRYPTION_SECRET', 'synthetic-unit-test-only');
    const value = 'synthetic-unit-test-value';
    const encrypted = encryptAiKey(value, 'tenant-a:openai:test-model');
    expect(decryptAiKey(encrypted, 'tenant-a:openai:test-model')).toBe(value);
    expect(() => decryptAiKey(encrypted, 'tenant-b:openai:test-model')).toThrow('reconnected');
    expect(() => decryptAiKey(encrypted, 'tenant-a:google:test-model')).toThrow('reconnected');
  });
});