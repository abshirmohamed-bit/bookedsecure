import { z } from 'zod';
export const aiProviderSchema = z.enum(['openai', 'anthropic', 'google', 'xai']);
export type TenantAiProvider = z.infer<typeof aiProviderSchema>;
export const tenantAiInputSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().trim().min(1).max(150).regex(/^[a-zA-Z0-9._-]+$/),
  apiKey: z.string().trim().min(1).max(4096),
});
export const AI_PROVIDER_LABELS: Record<TenantAiProvider, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic (Claude)', google: 'Google Gemini', xai: 'xAI (Grok)',
};
export function isCreditExhaustion(error: unknown): boolean {
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    const e = current as { statusCode?: unknown; status?: unknown; cause?: unknown };
    // Never use broad message matching: a policy denial is not a credit error.
    if (e.statusCode === 402 || e.status === 402) return true;
    if (e.statusCode === 403 || e.status === 403) return false;
    current = e.cause;
  }
  return false;
}