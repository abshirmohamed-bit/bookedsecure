import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { tenantAiInputSchema } from './tenant-ai';

export const getTenantAiConnection = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  const { aiConnectionStatus } = await import('./tenant-ai.server');
  return { ...await aiConnectionStatus(ctx.businessId), canRestoreGateway: ctx.isPlatformAdmin };
});
export const connectTenantAi = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => tenantAiInputSchema.parse(input)).handler(async ({ data, context }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  const { saveAiAccount } = await import('./tenant-ai.server');
  await saveAiAccount(ctx.businessId, ctx.userId, data);
  return { connected: true };
});
export const removeTenantAi = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  const { disconnectAiAccount } = await import('./tenant-ai.server');
  await disconnectAiAccount(ctx.businessId, ctx.userId);
  return { removed: true };
});
export const restoreLovableAi = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  if (!ctx.isPlatformAdmin) throw new Error('Only the platform owner can restore Lovable AI.');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error } = await supabaseAdmin.from('ai_gateway_state').upsert({ id: 'lovable', paused: false, reason: null, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not restore Lovable AI.');
  return { restored: true };
});