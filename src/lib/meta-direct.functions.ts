import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function directOwner(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

export const getDirectMetaStatus = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { DIRECT_META_ALLOWLIST, readDirectMetaConfig } = await import('./meta-direct.server');
  const config = readDirectMetaConfig(new URL(getRequest().url).hostname);
  if (!config.preview || ctx.businessId !== DIRECT_META_ALLOWLIST.businessId) return null;
  return {
    enabled: config.enabled, scheduleEnabled: config.scheduleEnabled,
    credentialConfigured: Boolean(config.token), versionConfigured: Boolean(config.version),
    accessVerified: false,
  };
});

/** Owner-initiated read-only probe. Never invoked automatically on page load.
 * It verifies grants, Page/form membership and a bounded leads read, but neither
 * saves a lead nor enables a mode/schedule. Not run as part of this edit.
 */
export const testDirectMetaAccess = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { readDirectMetaConfig, createDirectMetaTransport } = await import('./meta-direct.server');
  return createDirectMetaTransport(readDirectMetaConfig(new URL(getRequest().url).hostname)).testAccess(ctx.businessId);
});

export const importDirectMetaNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const hostname = new URL(getRequest().url).hostname;
  const { assertDirectMetaScope, readDirectMetaConfig } = await import('./meta-direct.server');
  assertDirectMetaScope(ctx.businessId, readDirectMetaConfig(hostname), true);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: conn, error } = await supabaseAdmin.from('lead_sync_connections')
    .select('id, business_id, provider, trigger_url, initial_lookback_days, consecutive_failures, status')
    .eq('business_id', ctx.businessId).eq('provider', 'meta_direct').maybeSingle();
  if (error || !conn || conn.status === 'disconnected') throw new Error('The separate direct Facebook connection is not configured.');
  const { startSyncRun } = await import('./lead-sync.server');
  return startSyncRun(conn, 'manual', ctx.userId, hostname);
});