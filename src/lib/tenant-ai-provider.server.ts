import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { streamText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { TenantAiProvider } from './tenant-ai';

export type AiAccount = { provider: TenantAiProvider; model: string; apiKey: string };
export function directAiProvider(account: AiAccount) {
  switch (account.provider) {
    case 'anthropic': return { model: createAnthropic({ apiKey: account.apiKey })(account.model), providerOptions: {} };
    case 'google': return { model: createGoogle({ apiKey: account.apiKey })(account.model), providerOptions: {} };
    case 'xai': return { model: createXai({ apiKey: account.apiKey }).responses(account.model), providerOptions: { xai: { store: false } } };
    case 'openai': return { model: createOpenAI({ apiKey: account.apiKey }).responses(account.model), providerOptions: { openai: { store: false } } };
  }
}

/** Tests both inference and a harmless function-call continuation before saving. */
export async function verifyAiAccount(account: AiAccount): Promise<void> {
  let called = false;
  try {
    const result = streamText({
      ...directAiProvider(account), maxRetries: 0,
      system: 'Call connection_check once, then reply with the returned text. This is a read-only connection test.',
      prompt: 'Verify this assistant connection.',
      tools: { connection_check: tool({ description: 'Read a fixed connection test value.', inputSchema: z.object({}), execute: async () => { called = true; return 'Connection verified'; } }) },
      stopWhen: stepCountIs(50),
    });
    const text = await result.text;
    if (!called || !text.trim()) throw new Error('not_verified');
  } catch { throw new Error('Could not verify this key and model. Check API billing, model access and function-calling support with your provider.'); }
}