import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createApiKeySchema } from './api-keys';

const KEY_COLUMNS = 'id, name, key_prefix, key_last4, scopes, last_used_at, request_count, revoked_at, created_at';

export const listApiKeys = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  const { data, error } = await context.supabase.from('api_keys').select(KEY_COLUMNS)
    .eq('business_id', ctx.businessId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error('Could not load API keys.');
  return data ?? [];
});

export const createApiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createApiKeySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import('./app-context.server');
    const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
    const { generateApiKey, hashApiKey, API_ACCESS_LEVELS, API_KEY_PREFIX } = await import('./api-keys');
    const key = generateApiKey();
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { count } = await supabaseAdmin.from('api_keys').select('id', { count: 'exact', head: true })
      .eq('business_id', ctx.businessId).is('revoked_at', null);
    if ((count ?? 0) >= 10) throw new Error('You can have up to 10 active keys. Revoke one first.');
    const { error } = await supabaseAdmin.from('api_keys').insert({
      business_id: ctx.businessId, name: data.name, key_prefix: API_KEY_PREFIX, key_last4: key.slice(-4),
      key_hash: await hashApiKey(key), scopes: [...API_ACCESS_LEVELS[data.access]], created_by: ctx.userId,
    });
    if (error) throw new Error('Could not create the API key.');
    return { key };
  });

export const revokeApiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import('./app-context.server');
    const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row, error } = await supabaseAdmin.from('api_keys').update({ revoked_at: new Date().toISOString() })
      .eq('id', data.id).eq('business_id', ctx.businessId).is('revoked_at', null).select('id').maybeSingle();
    if (error || !row) throw new Error('Could not revoke that key.');
    return { revoked: true };
  });
