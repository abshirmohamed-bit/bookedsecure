import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { MetaConnectError, encryptMetaToken, exchangeCodeForAccess, readMetaAppConfig, tokenContext, verifyState } from './meta-oauth.server';

const CONN_COLUMNS = 'id, business_id, provider, initial_lookback_days, consecutive_failures, status, auto_sync_enabled';
const PENDING_TTL_MS = 15 * 60_000;

/** Creates the business's direct Facebook connection on first use. */
export async function ensureDirectConnection(businessId: string, userId: string) {
  const { data: existing, error: loadErr } = await supabaseAdmin.from('lead_sync_connections').select(CONN_COLUMNS)
    .eq('business_id', businessId).eq('provider', 'meta_direct').maybeSingle();
  if (loadErr) throw new Error('Could not load the direct Facebook connection.');
  if (existing) return existing;
  const { data: created, error } = await supabaseAdmin.from('lead_sync_connections').upsert({
    business_id: businessId, provider: 'meta_direct', created_by: userId, status: 'connected',
    auto_sync_enabled: false, initial_lookback_days: 7,
  }, { onConflict: 'business_id,provider' }).select(CONN_COLUMNS).single();
  if (error || !created) throw new Error('Could not set up the direct Facebook connection.');
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
  try {
    const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
    await createDirectMetaTransport(await loadMetaAccount(businessId)).subscribeInstantLeads();
  } catch (e) {
    // Not fatal: the five-minute check still imports; the owner can retry "Turn on instant leads".
    console.error('instant leads subscribe failed', e instanceof Error ? e.message : 'unknown');
  }
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

  const { pages, userToken, userTokenExpiresAt } = await exchangeCodeForAccess(readMetaAppConfig(), code, fetcher);
  try {
    // Ad spend reporting: keep the user token and find the ad account. Never blocks connecting.
    const { saveAdAccess } = await import('./meta-ads.server');
    await saveAdAccess(who.businessId, userToken, userTokenExpiresAt, fetcher);
  } catch (e) {
    console.error('facebook ad access not saved', e instanceof Error ? e.message : 'unknown');
  }
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
