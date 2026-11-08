import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function ownerCtx(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId); requireOwner(ctx);
  return ctx;
}

const SAFE = 'id, provider, auto_sync_enabled, initial_lookback_days, status, last_success_at, last_attempt_at, next_check_at, last_error, consecutive_failures';

export const getLeadSync = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await ownerCtx(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: directConn, error } = await supabaseAdmin.from('lead_sync_connections').select(SAFE).eq('business_id', ctx.businessId).eq('provider', 'meta_direct').maybeSingle();
  if (error) throw new Error('Could not load the Facebook lead import.');
  const { metaAppReady, readMetaAppConfig } = await import('./meta-oauth.server');
  const { data: meta, error: metaErr } = await supabaseAdmin.from('meta_lead_accounts')
    .select('page_id, page_name, form_ids, connected_at, pending_pages, pending_expires_at').eq('business_id', ctx.businessId).maybeSingle();
  // A missing table (migration not yet applied) must not break the card or history.
  const setupError = metaErr
    ? (metaErr.code === 'PGRST205' || metaErr.code === '42P01' || /meta_lead_accounts/.test(metaErr.message ?? '')
      ? 'Direct Facebook import is waiting for a database update (migration 0021_meta_lead_accounts) to be applied.'
      : 'The Facebook connection could not be loaded. Please try again.')
    : null;
  if (metaErr) console.error('meta_lead_accounts read failed', metaErr.code, metaErr.message);
  const pendingLive = meta?.pending_expires_at && Date.parse(meta.pending_expires_at) > Date.now() && Array.isArray(meta.pending_pages);
  // Never returns tokens: only Page identity, form selection and connection health.
  const direct = {
    available: metaAppReady(readMetaAppConfig()) && !setupError,
    setupError,
    page: meta?.page_id ? { id: meta.page_id, name: meta.page_name, formCount: (meta.form_ids ?? []).length, connectedAt: meta.connected_at } : null,
    pendingPages: pendingLive ? (meta!.pending_pages as Array<{ id: string; name: string }>).map((p) => ({ id: String(p.id), name: String(p.name) })) : [],
    connection: directConn,
  };
  // History and progress of the direct Facebook connection only.
  const connId = directConn?.id ?? '00000000-0000-0000-0000-000000000000';
  const [runs, forms] = await Promise.all([
    context.supabase.from('lead_sync_runs').select('id, connection_id, trigger_kind, status, since, created_count, duplicate_count, enriched_count, skipped_count, failed_count, error, requested_at, completed_at').eq('business_id', ctx.businessId).eq('connection_id', connId).order('requested_at', { ascending: false }).limit(20),
    context.supabase.from('lead_sync_form_checkpoints').select('form_id, form_name, last_submitted_at').eq('business_id', ctx.businessId).eq('connection_id', connId).order('form_name'),
  ]);
  if (runs.error || forms.error) throw new Error('Could not load import history.');
  return {
    direct,
    runs: runs.data ?? [],
    forms: forms.data ?? [],
  };
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
