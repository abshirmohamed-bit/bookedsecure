import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { LEAD_SYNC_LOOKBACK_OPTIONS } from './lead-sync';

async function directOwner(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  const { isDirectMetaBusiness } = await import('./meta-direct.server');
  if (!isDirectMetaBusiness(ctx.businessId)) throw new Error('Direct Facebook import is not available for this account.');
  return ctx;
}

const CONN_COLUMNS = 'id, business_id, provider, trigger_url, initial_lookback_days, consecutive_failures, status, auto_sync_enabled';

async function loadDirectConnection(businessId: string) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.from('lead_sync_connections').select(CONN_COLUMNS)
    .eq('business_id', businessId).eq('provider', 'meta_direct').maybeSingle();
  if (error) throw new Error('Could not load the direct Facebook connection.');
  return data;
}

/**
 * Creates the direct connection on first use. Its form checkpoints start from
 * the Make connection's, so switching over continues where Make stopped rather
 * than re-reading the whole lookback window.
 */
async function ensureDirectConnection(businessId: string, userId: string) {
  const existing = await loadDirectConnection(businessId);
  if (existing) return existing;
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: make } = await supabaseAdmin.from('lead_sync_connections').select('id, initial_lookback_days')
    .eq('business_id', businessId).eq('provider', 'make').maybeSingle();
  const { data: created, error } = await supabaseAdmin.from('lead_sync_connections').upsert({
    business_id: businessId, provider: 'meta_direct', created_by: userId, status: 'connected',
    auto_sync_enabled: false, initial_lookback_days: make?.initial_lookback_days ?? 7,
  }, { onConflict: 'business_id,provider' }).select(CONN_COLUMNS).single();
  if (error || !created) throw new Error('Could not set up the direct Facebook connection.');
  if (make) {
    const { data: cps, error: cpErr } = await supabaseAdmin.from('lead_sync_form_checkpoints')
      .select('form_id, form_name, page_id, last_submitted_at').eq('connection_id', make.id).eq('business_id', businessId);
    if (cpErr) throw new Error('Could not copy import progress from Make.');
    if (cps?.length) {
      const { error: seedErr } = await supabaseAdmin.from('lead_sync_form_checkpoints').upsert(
        cps.map((c) => ({ ...c, business_id: businessId, connection_id: created.id })),
        { onConflict: 'connection_id,form_id', ignoreDuplicates: true },
      );
      if (seedErr) throw new Error('Could not copy import progress from Make.');
    }
  }
  return created;
}

/** Owner-initiated read-only probe: one bounded leads read per form. Saves nothing. */
export const testDirectMetaAccess = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { readDirectMetaConfig, createDirectMetaTransport } = await import('./meta-direct.server');
  try {
    return await createDirectMetaTransport(readDirectMetaConfig()).testAccess(ctx.businessId);
  } catch (e) {
    return { healthy: false as const, reason: e instanceof Error ? e.message : 'Facebook access could not be checked.' };
  }
});

export const saveDirectMeta = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    auto_sync_enabled: z.boolean().optional(),
    initial_lookback_days: z.number().int().refine((n) => (LEAD_SYNC_LOOKBACK_OPTIONS as readonly number[]).includes(n)).optional(),
    /** Also switch off Make's automatic checks so they stop using Make credits. */
    pause_make: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await directOwner(context);
    const conn = await ensureDirectConnection(ctx.businessId, ctx.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const patch: { status?: string; last_error?: null; consecutive_failures?: number; auto_sync_enabled?: boolean; next_check_at?: string | null; initial_lookback_days?: number } = {};
    if (conn.status === 'disconnected') Object.assign(patch, { status: 'connected', last_error: null, consecutive_failures: 0 });
    if (data.auto_sync_enabled !== undefined) Object.assign(patch, { auto_sync_enabled: data.auto_sync_enabled, ...(data.auto_sync_enabled ? { next_check_at: new Date().toISOString(), consecutive_failures: 0 } : { next_check_at: null }) });
    if (data.initial_lookback_days !== undefined) patch['initial_lookback_days'] = data.initial_lookback_days;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('lead_sync_connections').update(patch).eq('id', conn.id).eq('business_id', ctx.businessId);
      if (error) throw new Error('Could not save the settings.');
    }
    if (data.pause_make) {
      const { error } = await supabaseAdmin.from('lead_sync_connections').update({ auto_sync_enabled: false, next_check_at: null })
        .eq('business_id', ctx.businessId).eq('provider', 'make');
      if (error) throw new Error('Saved, but Make’s automatic checks could not be switched off.');
    }
    return { ok: true };
  });

export const importDirectMetaNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const conn = await ensureDirectConnection(ctx.businessId, ctx.userId);
  if (conn.status === 'disconnected') throw new Error('Turn the direct Facebook import back on first.');
  const { startSyncRun } = await import('./lead-sync.server');
  return startSyncRun(conn, 'manual', ctx.userId);
});

export const disconnectDirectMeta = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error } = await supabaseAdmin.from('lead_sync_connections').update({ auto_sync_enabled: false, status: 'disconnected', next_check_at: null })
    .eq('business_id', ctx.businessId).eq('provider', 'meta_direct');
  if (error) throw new Error('Could not turn off the direct import.');
  return { ok: true };
});
