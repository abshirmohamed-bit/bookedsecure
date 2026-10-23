import { describe, expect, it } from 'vitest';
import { isCreditExhaustion, tenantAiInputSchema } from './tenant-ai';
describe('tenant AI backup rules', () => {
  it('switches for a confirmed credit-exhaustion status', () => {
    expect(isCreditExhaustion({ cause: { statusCode: 402 } })).toBe(true);
  });
  it.each([400, 401, 403, 404, 429, 500])('does not switch providers for status %s', statusCode => {
    expect(isCreditExhaustion({ statusCode })).toBe(false);
  });
  it('does not mistake denial wording mentioning credits for credit exhaustion', () => {
    expect(isCreditExhaustion({ statusCode: 403, message: 'credits policy denied', cause: { statusCode: 402 } })).toBe(false);
  });
  it.each(['openai', 'anthropic', 'google', 'xai'])('accepts one shared key form for %s', provider => {
    expect(tenantAiInputSchema.safeParse({ provider, model: 'test-model', apiKey: 'synthetic-test-value' }).success).toBe(true);
  });
  it('rejects arbitrary provider hosts', () => {
    expect(tenantAiInputSchema.safeParse({ provider: 'https://attacker.example', model: 'test-model', apiKey: 'synthetic-test-value' }).success).toBe(false);
  });
});