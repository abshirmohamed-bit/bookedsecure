import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function admin(context: { supabase: never; userId: string }) {
  const { requirePlatformAdmin } = await import('./pilot.server');
  await requirePlatformAdmin(context.supabase, context.userId);
}

export const getAiRouting = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await admin(context as never);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { EXTERNAL_AI_SECRET, normaliseRouting } = await import('./ai-router');
  const { data, error } = await supabaseAdmin.from('ai_gateway_state').select('*').eq('id', 'routing').maybeSingle();
  if (error) throw new Error('Could not load AI provider settings.');
  return { ...normaliseRouting(data as Record<string, unknown> | null), keyConfigured: Boolean(process.env[EXTERNAL_AI_SECRET]), lastCheck: (data?.last_check ?? null) as { ok: boolean; at: string; message: string } | null };
});

const routingInput = z.object({
  primary: z.enum(['lovable', 'external']),
  lovableStandby: z.boolean(),
  fastModel: z.string().trim().min(1).max(120).regex(/^[\w./:-]+$/),
  agentModel: z.string().trim().min(1).max(120).regex(/^[\w./:-]+$/),
});

export const setAiRouting = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator((i: unknown) => routingInput.parse(i)).handler(async ({ data, context }) => {
  await admin(context as never);
  if (data.primary === 'lovable' && !data.lovableStandby) throw new Error('Lovable cannot be primary while turned off.');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { EXTERNAL_AI_SECRET } = await import('./ai-router');
  if (data.primary === 'external' && !process.env[EXTERNAL_AI_SECRET]) throw new Error('Add the Cheaper Inference key before making it primary.');
  const { error } = await supabaseAdmin.from('ai_gateway_state').upsert({ id: 'routing', primary_provider: data.primary, lovable_standby: data.lovableStandby, fast_model: data.fastModel, agent_model: data.agentModel, updated_at: new Date().toISOString() });
  if (error) throw new Error('AI provider settings could not be saved.');
  return { saved: true };
});

/** Live check: inference plus a harmless tool-call continuation on both models. */
export const checkExternalAi = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await admin(context as never);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { externalAiProvider, loadRouting } = await import('./tenant-ai.server');
  const { streamText, stepCountIs, tool } = await import('ai');
  const routing = await loadRouting();
  let ok = true; let message = 'Both models answered and used a tool correctly.';
  for (const model of new Set([routing.fastModel, routing.agentModel])) {
    const provider = externalAiProvider(model);
    if (!provider) { ok = false; message = 'The Cheaper Inference key is not saved yet.'; break; }
    let called = false; let failure: unknown = null;
    try {
      const result = streamText({ ...provider, maxRetries: 0, system: 'Call connection_check once, then reply with the returned text.', prompt: 'Verify this connection.',
        tools: { connection_check: tool({ description: 'Read a fixed test value.', inputSchema: z.object({}), execute: async () => { called = true; return 'Connection verified'; } }) },
        stopWhen: stepCountIs(4), onError: ({ error }) => { failure = error; } });
      const text = await result.text;
      if (failure || !called || !text.trim()) { ok = false; message = `Model ${model} ${called ? 'did not reply after using a tool' : 'did not use tools'}${failure ? ' (provider error)' : ''}.`; break; }
    } catch { ok = false; message = `Model ${model} could not be reached.`; break; }
  }
  const lastCheck = { ok, at: new Date().toISOString(), message };
  await supabaseAdmin.from('ai_gateway_state').update({ last_check: lastCheck }).eq('id', 'routing');
  return lastCheck;
});
