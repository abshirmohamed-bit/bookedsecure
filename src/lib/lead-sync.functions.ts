import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { saveConnectionSchema } from './lead-sync';

async function ownerCtx(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  return ctx;
}

const SAFE = 'id, provider, trigger_url, auto_sync_enabled, initial_lookback_days, status, last_success_at, last_attempt_at, next_check_at, last_error, consecutive_failures';

export const getLeadSync = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await ownerCtx(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: conns, error } = await supabaseAdmin.from('lead_sync_connections').select(SAFE).eq('business_id', ctx.businessId).in('provider', ['make', 'meta_direct']);
  if (error) throw new Error('Could not load the Facebook lead import.');
  const conn = (conns ?? []).find((c) => c.provider === 'make') ?? null;
  const directConn = (conns ?? []).find((c) => c.provider === 'meta_direct') ?? null;
  const { metaAppReady, readMetaAppConfig } = await import('./meta-oauth.server');
  const { data: meta, error: metaErr } = await supabaseAdmin.from('meta_lead_accounts')
    .select('page_id, page_name, form_ids, connected_at, pending_pages, pending_expires_at').eq('business_id', ctx.businessId).maybeSingle();
  if (metaErr) throw new Error('Could not load the Facebook connection.');
  const pendingLive = meta?.pending_expires_at && Date.parse(meta.pending_expires_at) > Date.now() && Array.isArray(meta.pending_pages);
  // Never returns tokens: only Page identity, form selection and connection health.
  const direct = {
    available: metaAppReady(readMetaAppConfig()),
    page: meta?.page_id ? { id: meta.page_id, name: meta.page_name, formCount: (meta.form_ids ?? []).length, connectedAt: meta.connected_at } : null,
    pendingPages: pendingLive ? (meta!.pending_pages as Array<{ id: string; name: string }>).map((p) => ({ id: String(p.id), name: String(p.name) })) : [],
    connection: directConn ? (({ trigger_url: _t, ...rest }) => rest)(directConn) : null,
  };
  const [runs, forms] = await Promise.all([
    context.supabase.from('lead_sync_runs').select('id, connection_id, trigger_kind, status, since, created_count, duplicate_count, enriched_count, skipped_count, failed_count, error, requested_at, completed_at').eq('business_id', ctx.businessId).order('requested_at', { ascending: false }).limit(20),
    context.supabase.from('lead_sync_form_checkpoints').select('form_id, form_name, last_submitted_at').eq('business_id', ctx.businessId).order('form_name'),
  ]);
  if (runs.error || forms.error) throw new Error('Could not load import history.');
  let connection = null;
  if (conn) {
    const { trigger_url, ...rest } = conn;
    connection = { ...rest, has_trigger: Boolean(trigger_url), trigger_hint: trigger_url ? `…${trigger_url.slice(-4)}` : null };
  }
  return {
    connection, direct,
    runs: (runs.data ?? []).map((r) => ({ ...r, source: directConn && r.connection_id === directConn.id ? 'direct' as const : 'make' as const })),
    forms: forms.data ?? [],
  };
});

export const saveLeadSync = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveConnectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerCtx(context);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const patch: Record<string, unknown> = {};
    if (data.trigger_url !== undefined) Object.assign(patch, { trigger_url: data.trigger_url, status: 'connected', last_error: null, consecutive_failures: 0 });
    if (data.auto_sync_enabled !== undefined) Object.assign(patch, { auto_sync_enabled: data.auto_sync_enabled, ...(data.auto_sync_enabled ? { next_check_at: new Date().toISOString(), consecutive_failures: 0 } : {}) });
    if (data.initial_lookback_days !== undefined) patch['initial_lookback_days'] = data.initial_lookback_days;
    const { error } = await supabaseAdmin.from('lead_sync_connections').upsert({ business_id: ctx.businessId, provider: 'make', created_by: ctx.userId, ...patch }, { onConflict: 'business_id,provider' });
    if (error) throw new Error('Could not save the settings.');
    return { ok: true };
  });

export const importLeadsNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await ownerCtx(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: conn, error } = await supabaseAdmin.from('lead_sync_connections').select('id, business_id, trigger_url, initial_lookback_days, consecutive_failures, status').eq('business_id', ctx.businessId).eq('provider', 'make').maybeSingle();
  if (error) throw new Error('Could not load the connection.');
  if (!conn || conn.status === 'disconnected' || !conn.trigger_url) throw new Error('Add your Make webhook address first.');
  const { startSyncRun } = await import('./lead-sync.server');
  return startSyncRun(conn, 'manual', ctx.userId);
});

export const disconnectLeadSync = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await ownerCtx(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error } = await supabaseAdmin.from('lead_sync_connections').update({ trigger_url: null, auto_sync_enabled: false, status: 'disconnected', next_check_at: null }).eq('business_id', ctx.businessId).eq('provider', 'make');
  if (error) throw new Error('Could not disconnect.');
  return { ok: true };
});

export const getRunItems = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerCtx(context);
    const { data: items, error } = await context.supabase.from('lead_sync_items').select('id, meta_lead_id, form_name, submitted_at, outcome, reason, lead_id, display_name')
      .eq('business_id', ctx.businessId).eq('run_id', data.runId).order('submitted_at', { ascending: false }).limit(200);
    if (error) throw new Error('Could not load the import details.');
    return items ?? [];
  });
