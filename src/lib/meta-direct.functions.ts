import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { LEAD_SYNC_LOOKBACK_OPTIONS } from './lead-sync';

async function directOwner(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

/** Step 1: returns the Facebook sign-in address for this owner. */
export const startMetaConnect = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { buildLoginUrl, readMetaAppConfig, signState } = await import('./meta-oauth.server');
  return { url: buildLoginUrl(readMetaAppConfig(), signState({ businessId: ctx.businessId, userId: ctx.userId })) };
});

/** Step 2 (only when the owner manages several Pages): keep the chosen Page, drop the rest. */
export const chooseMetaPage = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ pageId: z.string().regex(/^\d{3,40}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await directOwner(context);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row, error } = await supabaseAdmin.from('meta_lead_accounts').select('pending_pages, pending_expires_at').eq('business_id', ctx.businessId).maybeSingle();
    if (error) throw new Error('Could not load the Facebook Pages.');
    const pending = z.array(z.object({ id: z.string(), name: z.string(), token_ciphertext: z.string() })).safeParse(row?.pending_pages);
    if (!pending.success || !row?.pending_expires_at || Date.parse(row.pending_expires_at) < Date.now()) throw new Error('This choice has expired. Connect Facebook again.');
    const page = pending.data.find((p) => p.id === data.pageId);
    if (!page) throw new Error('That Page was not part of this Facebook connection.');
    const { saveConnectedPage } = await import('./meta-connect.server');
    await saveConnectedPage(ctx.businessId, ctx.userId, page);
    return { ok: true };
  });

/** The connected Page's lead forms, for the form picker. */
export const listMetaForms = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
  const account = await loadMetaAccount(ctx.businessId);
  const forms = await createDirectMetaTransport(account).listForms();
  return { forms, selected: account.formIds };
});

export const saveMetaForms = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ formIds: z.array(z.string().regex(/^\d{3,40}$/)).max(50) }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await directOwner(context);
    const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
    const account = await loadMetaAccount(ctx.businessId);
    if (data.formIds.length) {
      const onPage = new Set((await createDirectMetaTransport(account).listForms()).map((f) => f.id));
      if (data.formIds.some((id) => !onPage.has(id))) throw new Error('One of those forms is not on the connected Page.');
    }
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.from('meta_lead_accounts').update({ form_ids: [...new Set(data.formIds)], updated_at: new Date().toISOString() }).eq('business_id', ctx.businessId);
    if (error) throw new Error('Could not save the form selection.');
    return { ok: true };
  });

/** Owner-initiated read-only probe: one bounded leads read per form. Saves nothing. */
export const testDirectMetaAccess = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  try {
    const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
    const { readMetaAppConfig } = await import('./meta-oauth.server');
    return await createDirectMetaTransport(await loadMetaAccount(ctx.businessId)).testAccess(new Date(), readMetaAppConfig().appId);
  } catch (e) {
    return { healthy: false as const, reason: e instanceof Error ? e.message : 'Facebook access could not be checked.' };
  }
});

export const saveDirectMeta = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    auto_sync_enabled: z.boolean().optional(),
    initial_lookback_days: z.number().int().refine((n) => (LEAD_SYNC_LOOKBACK_OPTIONS as readonly number[]).includes(n)).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await directOwner(context);
    const { ensureDirectConnection } = await import('./meta-connect.server');
    const conn = await ensureDirectConnection(ctx.businessId, ctx.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const patch: { status?: string; last_error?: null; consecutive_failures?: number; auto_sync_enabled?: boolean; next_check_at?: string | null; initial_lookback_days?: number } = {};
    if (conn.status === 'disconnected') Object.assign(patch, { status: 'connected', last_error: null, consecutive_failures: 0 });
    if (data.auto_sync_enabled !== undefined) Object.assign(patch, { auto_sync_enabled: data.auto_sync_enabled, ...(data.auto_sync_enabled ? { next_check_at: new Date().toISOString(), consecutive_failures: 0 } : { next_check_at: null }) });
    if (data.initial_lookback_days !== undefined) patch.initial_lookback_days = data.initial_lookback_days;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('lead_sync_connections').update(patch).eq('id', conn.id).eq('business_id', ctx.businessId);
      if (error) throw new Error('Could not save the settings.');
    }
    return { ok: true };
  });

export const importDirectMetaNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { ensureDirectConnection } = await import('./meta-connect.server');
    const conn = await ensureDirectConnection(ctx.businessId, ctx.userId);
  if (conn.status === 'disconnected') throw new Error('Connect Facebook first.');
  const { startSyncRun } = await import('./lead-sync.server');
  return startSyncRun(conn, 'manual', ctx.userId);
});

/** Subscribes the connected Page to Facebook's new-lead webhook, then confirms it. */
export const enableInstantLeads = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
  const { readMetaAppConfig } = await import('./meta-oauth.server');
  const transport = createDirectMetaTransport(await loadMetaAccount(ctx.businessId));
  await transport.subscribeInstantLeads();
  const appId = readMetaAppConfig().appId;
  return { on: appId ? await transport.instantLeadsOn(appId) : false };
});

/** Removes the stored Page token and stops direct imports. Import history is kept. */
export const disconnectDirectMeta = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const ctx = await directOwner(context);
  try {
    // Best effort: stop Facebook sending instant lead webhooks for this Page.
    const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
    await createDirectMetaTransport(await loadMetaAccount(ctx.businessId)).unsubscribeInstantLeads();
  } catch { /* already disconnected or token revoked */ }
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error: delErr } = await supabaseAdmin.from('meta_lead_accounts').delete().eq('business_id', ctx.businessId);
  if (delErr) throw new Error('Could not disconnect Facebook.');
  const { error } = await supabaseAdmin.from('lead_sync_connections').update({ auto_sync_enabled: false, status: 'disconnected', next_check_at: null })
    .eq('business_id', ctx.businessId).eq('provider', 'meta_direct');
  if (error) throw new Error('Facebook was disconnected, but automatic checks could not be switched off.');
  await supabaseAdmin.from('audit_events').insert({ business_id: ctx.businessId, user_id: ctx.userId, event_type: 'meta_leads_disconnected', entity_type: 'business', entity_id: ctx.businessId, metadata: {} });
  return { ok: true };
});
