import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { MetaConnectError, encryptMetaToken, exchangeCodeForPages, readMetaAppConfig, tokenContext, verifyState } from './meta-oauth.server';

const CONN_COLUMNS = 'id, business_id, provider, trigger_url, initial_lookback_days, consecutive_failures, status, auto_sync_enabled';
const PENDING_TTL_MS = 15 * 60_000;

/**
 * Creates the direct connection on first use. Its form checkpoints start from
 * the Make connection's, so switching over continues where Make stopped rather
 * than re-reading the whole lookback window.
 */
export async function ensureDirectConnection(businessId: string, userId: string) {
  const { data: existing, error: loadErr } = await supabaseAdmin.from('lead_sync_connections').select(CONN_COLUMNS)
    .eq('business_id', businessId).eq('provider', 'meta_direct').maybeSingle();
  if (loadErr) throw new Error('Could not load the direct Facebook connection.');
  if (existing) return existing;
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

/** Stores the chosen Page. Reconnecting the same Page keeps the owner's form selection. */
export async function saveConnectedPage(businessId: string, userId: string, page: { id: string; name: string; token_ciphertext: string }) {
  const { data: prior } = await supabaseAdmin.from('meta_lead_accounts').select('page_id, form_ids').eq('business_id', businessId).maybeSingle();
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('meta_lead_accounts').upsert({
    business_id: businessId, page_id: page.id, page_name: page.name.slice(0, 200), token_ciphertext: page.token_ciphertext,
    form_ids: prior?.page_id === page.id ? (prior.form_ids ?? []) : [],
    pending_pages: null, pending_expires_at: null, connected_by: userId, connected_at: now, updated_at: now,
  }, { onConflict: 'business_id' });
  if (error) throw new Error('Could not save the Facebook connection.');
  const conn = await ensureDirectConnection(businessId, userId);
  const { error: connErr } = await supabaseAdmin.from('lead_sync_connections')
    .update({ status: 'connected', last_error: null, consecutive_failures: 0 }).eq('id', conn.id);
  if (connErr) throw new Error('Could not update the direct Facebook connection.');
  await supabaseAdmin.from('audit_events').insert({ business_id: businessId, user_id: userId, event_type: 'meta_leads_connected', entity_type: 'business', entity_id: businessId, metadata: { page_id: page.id } });
}

/**
 * Finishes the Facebook sign-in. The signed state names the business and owner
 * who started it; ownership is re-checked here because the callback carries no
 * BookedSecure session. Returns whether the owner still has to pick a Page.
 */
export async function completeMetaConnect(code: string, state: string, fetcher: typeof fetch = fetch): Promise<'connected' | 'choose'> {
  const who = verifyState(state);
  if (!who) throw new Error('This Facebook sign-in link has expired. Please connect again.');
  const { requireAppContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireAppContext(supabaseAdmin, who.userId).catch(() => { throw new MetaConnectError('Your BookedSecure account could not be checked.', 'owner'); });
  try { requireOwner(ctx); } catch { throw new MetaConnectError('Only the business owner can connect Facebook.', 'owner'); }
  if (ctx.businessId !== who.businessId) throw new MetaConnectError('This Facebook sign-in belongs to a different business.', 'owner_business');

  const pages = await exchangeCodeForPages(readMetaAppConfig(), code, fetcher);
  if (!pages.length) throw new Error('No Facebook Page was shared. Connect again and tick your business Page.');
  let sealed: Array<{ id: string; name: string; token_ciphertext: string }>;
  try { sealed = pages.map((p) => ({ id: p.id, name: p.name, token_ciphertext: encryptMetaToken(p.token, tokenContext(who.businessId, p.id)) })); }
  catch { throw new MetaConnectError('Secure token storage is unavailable.', 'encrypt'); }
  if (sealed.length === 1) {
    try { await saveConnectedPage(who.businessId, who.userId, sealed[0]!); }
    catch (e) { throw new MetaConnectError(e instanceof Error ? e.message : 'Could not save the Facebook connection.', 'save'); }
    return 'connected';
  }
  const { error } = await supabaseAdmin.from('meta_lead_accounts').upsert({
    business_id: who.businessId, pending_pages: sealed, pending_expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id' });
  if (error) throw new MetaConnectError('Could not save the Facebook Pages.', 'save_pending');
  return 'choose';
}
