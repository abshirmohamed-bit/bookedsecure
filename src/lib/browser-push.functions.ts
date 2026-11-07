import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const getPushSettings = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext } = await import('./app-context.server');
  const app = await requireAppContext(context.supabase, context.userId);
  const [settings, devices] = await Promise.all([
    context.supabase.from('owner_push_settings').select('sms_fallback').eq('business_id', app.businessId).maybeSingle(),
    context.supabase.from('owner_push_devices').select('id', { count: 'exact' }).eq('business_id', app.businessId).eq('user_id', context.userId),
  ]);
  if (settings.error || devices.error) throw new Error('Could not load push settings.');
  return { owner: app.role === 'owner', smsFallback: settings.data?.sms_fallback ?? false, devices: devices.count ?? 0 };
});
export const savePushDevice = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ token: z.string().min(20).max(4096) }).parse(v)).handler(async ({ context, data }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const app = await requireAppContext(context.supabase, context.userId); requireOwner(app);
  const result = await context.supabase.from('owner_push_devices').upsert({ business_id: app.businessId, user_id: context.userId, token: data.token, updated_at: new Date().toISOString() }, { onConflict: 'token' });
  if (result.error) throw new Error('Could not save this notification device. Disable its previous account registration before changing accounts.');
  return { ok: true };
});
export const removePushDevice = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ token: z.string().min(20).max(4096) }).parse(v)).handler(async ({ context, data }) => {
  const { requireAppContext } = await import('./app-context.server');
  const app = await requireAppContext(context.supabase, context.userId);
  const result = await context.supabase.from('owner_push_devices').delete().eq('business_id', app.businessId).eq('user_id', context.userId).eq('token', data.token);
  if (result.error) throw new Error('Could not disable this notification device.');
  return { ok: true };
});
export const savePushFallback = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ enabled: z.boolean() }).parse(v)).handler(async ({ context, data }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const app = await requireAppContext(context.supabase, context.userId); requireOwner(app);
  const result = await context.supabase.from('owner_push_settings').upsert({ business_id: app.businessId, sms_fallback: data.enabled, updated_at: new Date().toISOString() });
  if (result.error) throw new Error('Could not save SMS fallback.');
  return { ok: true };
});
export const testBrowserPush = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const app = await requireAppContext(context.supabase, context.userId); requireOwner(app);
  const { deliverOwnerPush } = await import('./browser-push.server');
  return deliverOwnerPush({ businessId: app.businessId, alertKey: `test:${crypto.randomUUID()}`, title: 'BookedSecure test notification', body: 'Your new-lead push alerts are connected.', path: '/notifications', userId: context.userId });
});