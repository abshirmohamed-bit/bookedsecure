import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { buildAdPerformance, metaLeadCount, type JobRow, type LeadRow, type SpendRow } from './meta-ads';
import { decryptMetaToken, encryptMetaToken, readMetaAppConfig } from './meta-oauth.server';

/**
 * Ad spend needs the Marketing API, which a Page token can't call, so the
 * connecting person's long-lived user token (about 60 days) is kept encrypted,
 * bound to the business and ad account, in server-only meta_ad_accounts.
 * Nothing here can change ads: it only reads accounts and insights.
 */
const userTokenContext = (businessId: string) => `meta-user:${businessId}`;
const SYNC_EVERY_MS = 55 * 60_000;
const FIRST_SYNC_DAYS = 90;
const RESYNC_DAYS = 3;

const accountsPage = z.object({ data: z.array(z.object({ account_id: z.string(), name: z.string().optional(), currency: z.string().optional(), account_status: z.number().optional() })) });
const insightsPage = z.object({
  data: z.array(z.object({ campaign_id: z.string().optional(), campaign_name: z.string().optional(), date_start: z.string(), spend: z.string().optional(), actions: z.array(z.object({ action_type: z.string().optional(), value: z.union([z.string(), z.number()]).optional() })).optional() })),
  paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional(),
});

export type AdAccountChoice = { id: string; name: string; currency: string | null };

async function graph(path: string, params: Record<string, string>, token: string, fetcher: typeof fetch) {
  const url = new URL(`https://graph.facebook.com/${readMetaAppConfig().version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try { res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error('Facebook could not be reached for ad spend.'); }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || (typeof body === 'object' && 'error' in body)) {
    const code = z.object({ error: z.object({ code: z.number().optional() }) }).safeParse(body);
    const c = code.success ? code.data.error.code : undefined;
    if (c === 190) throw new Error('Facebook ad access has expired. Reconnect Facebook to keep ad spend up to date.');
    if (c === 10 || c === 200 || c === 272 || res.status === 403) throw new Error('Facebook refused access to ad spend. Reconnect Facebook with an account that can see the ad account.');
    if (c === 4 || c === 17 || c === 613 || res.status === 429) throw new Error('Facebook is rate-limiting ad spend reads. It will retry later.');
    throw new Error(`Facebook ad spend read failed (${res.status}).`);
  }
  return body;
}

/**
 * Called after Connect Facebook: keeps the user token and picks the ad account.
 * Prefers the account that runs the campaigns already seen on this business's
 * leads, then the only account, then the first active one. Best effort: a
 * failure never blocks the Facebook connection itself.
 */
export async function saveAdAccess(businessId: string, userToken: string, expiresAt: string | null, fetcher: typeof fetch = fetch): Promise<AdAccountChoice | null> {
  const parsed = accountsPage.safeParse(await graph('me/adaccounts', { fields: 'account_id,name,currency,account_status', limit: '50' }, userToken, fetcher));
  const accounts = parsed.success ? parsed.data.data : [];
  const choices: AdAccountChoice[] = accounts.map((a) => ({ id: a.account_id, name: a.name ?? a.account_id, currency: a.currency ?? null }));
  let chosen: AdAccountChoice | undefined;
  if (choices.length > 1) {
    const { data: recent } = await supabaseAdmin.from('leads').select('campaign_id:source_metadata->ad->>campaign_id').eq('business_id', businessId)
      .not('source_metadata->ad->>campaign_id', 'is', null).order('created_at', { ascending: false }).limit(1);
    const campaignId = (recent?.[0] as { campaign_id?: string } | undefined)?.campaign_id;
    if (campaignId && /^\d+$/.test(campaignId)) {
      const camp = z.object({ account_id: z.string() }).safeParse(await graph(campaignId, { fields: 'account_id' }, userToken, fetcher).catch(() => null));
      if (camp.success) chosen = choices.find((c) => c.id === camp.data.account_id);
    }
  }
  chosen ??= choices.length === 1 ? choices[0] : choices.find((_, i) => accounts[i]?.account_status === 1) ?? choices[0];
  const { error } = await supabaseAdmin.from('meta_ad_accounts').upsert({
    business_id: businessId, ad_account_id: chosen?.id ?? null, ad_account_name: chosen?.name ?? null, currency: chosen?.currency ?? null,
    available_accounts: choices, user_token_ciphertext: encryptMetaToken(userToken, userTokenContext(businessId)), token_expires_at: expiresAt,
    last_spend_sync_at: null, last_error: choices.length ? null : 'No Facebook ad account was found for this login.', updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id' });
  if (error) throw new Error('Could not save Facebook ad access.');
  return chosen ?? null;
}

export async function chooseAdAccount(businessId: string, accountId: string) {
  const { data, error } = await supabaseAdmin.from('meta_ad_accounts').select('available_accounts').eq('business_id', businessId).maybeSingle();
  if (error || !data) throw new Error('Connect Facebook first.');
  const choice = z.array(z.object({ id: z.string(), name: z.string(), currency: z.string().nullable() })).catch([]).parse(data.available_accounts).find((a) => a.id === accountId);
  if (!choice) throw new Error('That ad account was not part of your Facebook connection.');
  const { error: upErr } = await supabaseAdmin.from('meta_ad_accounts').update({ ad_account_id: choice.id, ad_account_name: choice.name, currency: choice.currency, last_spend_sync_at: null, updated_at: new Date().toISOString() }).eq('business_id', businessId);
  if (upErr) throw new Error('Could not change the ad account.');
  // Spend from the previous account no longer applies.
  await supabaseAdmin.from('meta_ad_spend_daily').delete().eq('business_id', businessId).neq('ad_account_id', choice.id);
}

/** Pulls daily spend per campaign (90 days first time, then the last 3, which Meta still adjusts). */
export async function syncAdSpend(businessId: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ rows: number }> {
  const { data: acct, error } = await supabaseAdmin.from('meta_ad_accounts').select('ad_account_id, user_token_ciphertext, last_spend_sync_at').eq('business_id', businessId).maybeSingle();
  if (error) throw new Error('Could not load Facebook ad access.');
  if (!acct?.ad_account_id || !acct.user_token_ciphertext) throw new Error('Reconnect Facebook to load ad spend.');
  const accountId = acct.ad_account_id;
  try {
    const token = decryptMetaToken(acct.user_token_ciphertext, userTokenContext(businessId));
    const days = acct.last_spend_sync_at ? RESYNC_DAYS : FIRST_SYNC_DAYS;
    const until = now.toISOString().slice(0, 10);
    const since = new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const rows: Array<SpendRow & { business_id: string; ad_account_id: string; updated_at: string }> = [];
    let after: string | undefined;
    for (let page = 0; page < 40; page++) {
      const parsed = insightsPage.safeParse(await graph(`act_${accountId}/insights`, {
        level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since, until }),
        fields: 'campaign_id,campaign_name,spend,actions', limit: '500', ...(after ? { after } : {}),
      }, token, fetcher));
      if (!parsed.success) throw new Error('Facebook returned invalid ad spend data.');
      for (const r of parsed.data.data) {
        if (!r.campaign_id) continue;
        rows.push({ business_id: businessId, ad_account_id: accountId, campaign_id: r.campaign_id, campaign_name: r.campaign_name ?? null, date: r.date_start, spend: Number(r.spend) || 0, meta_leads: metaLeadCount(r.actions), updated_at: now.toISOString() });
      }
      after = parsed.data.paging?.next ? parsed.data.paging.cursors?.after : undefined;
      if (!after) break;
    }
    if (rows.length) {
      const { error: upErr } = await supabaseAdmin.from('meta_ad_spend_daily').upsert(rows, { onConflict: 'business_id,campaign_id,date' });
      if (upErr) throw new Error('Could not save ad spend.');
    }
    await supabaseAdmin.from('meta_ad_accounts').update({ last_spend_sync_at: now.toISOString(), last_error: null }).eq('business_id', businessId);
    return { rows: rows.length };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Ad spend could not be loaded.';
    await supabaseAdmin.from('meta_ad_accounts').update({ last_error: reason, last_spend_sync_at: now.toISOString() }).eq('business_id', businessId);
    throw new Error(reason);
  }
}

/** Hourly from the five-minute sweep; a missing table or one failing business never stops lead imports. */
export async function sweepAdSpend(now = new Date()) {
  const cutoff = new Date(now.getTime() - SYNC_EVERY_MS).toISOString();
  const { data, error } = await supabaseAdmin.from('meta_ad_accounts').select('business_id')
    .not('ad_account_id', 'is', null).or(`last_spend_sync_at.is.null,last_spend_sync_at.lt.${cutoff}`).limit(10);
  if (error) return { synced: 0 };
  let synced = 0;
  for (const a of data ?? []) {
    try { await syncAdSpend(a.business_id, fetch, now); synced++; } catch { /* recorded on the account */ }
  }
  return { synced };
}

/** Campaign performance for the last `days` days, in the business's ad account currency. */
export async function adPerformance(businessId: string, days: number, now = new Date()) {
  const { data: acct, error: acctErr } = await supabaseAdmin.from('meta_ad_accounts')
    .select('ad_account_id, ad_account_name, currency, available_accounts, token_expires_at, last_spend_sync_at, last_error').eq('business_id', businessId).maybeSingle();
  const setupMissing = Boolean(acctErr && (acctErr.code === 'PGRST205' || acctErr.code === '42P01'));
  if (acctErr && !setupMissing) throw new Error('Could not load Facebook ad access.');
  const sinceDate = new Date(now.getTime() - (days - 1) * 86400_000);
  const since = sinceDate.toISOString().slice(0, 10);
  const spendRes = acct?.ad_account_id
    ? await supabaseAdmin.from('meta_ad_spend_daily').select('campaign_id, campaign_name, date, spend, meta_leads').eq('business_id', businessId).eq('ad_account_id', acct.ad_account_id).gte('date', since).limit(5000)
    : { data: [], error: null };
  if (spendRes.error) throw new Error('Could not load ad spend.');
  const leadsRes = await supabaseAdmin.from('leads').select('id, source_campaign, campaign_id:source_metadata->ad->>campaign_id')
    .eq('business_id', businessId).eq('source_channel', 'meta').is('deleted_at', null).gte('created_at', sinceDate.toISOString()).limit(5000);
  if (leadsRes.error) throw new Error('Could not load leads.');
  const leads: LeadRow[] = (leadsRes.data ?? []).map((l) => ({ id: l.id, campaign_id: (l as { campaign_id?: string | null }).campaign_id ?? null, campaign_name: l.source_campaign }));
  const jobs: JobRow[] = [];
  for (let i = 0; i < leads.length; i += 200) {
    const ids = leads.slice(i, i + 200).map((l) => l.id);
    const { data, error } = await supabaseAdmin.from('jobs').select('lead_id, scheduled_at, completion_status, completed_value').eq('business_id', businessId).in('lead_id', ids);
    if (error) throw new Error('Could not load jobs.');
    for (const j of data ?? []) if (j.lead_id) jobs.push({ lead_id: j.lead_id, scheduled_at: j.scheduled_at, completion_status: j.completion_status, completed_value: j.completed_value === null ? null : Number(j.completed_value) });
  }
  const spend: SpendRow[] = (spendRes.data ?? []).map((s) => ({ campaign_id: s.campaign_id, campaign_name: s.campaign_name, date: s.date, spend: Number(s.spend) || 0, meta_leads: s.meta_leads ?? 0 }));
  return {
    account: acct ? { id: acct.ad_account_id, name: acct.ad_account_name, currency: acct.currency, choices: z.array(z.object({ id: z.string(), name: z.string() })).catch([]).parse(acct.available_accounts), tokenExpiresAt: acct.token_expires_at, lastSyncAt: acct.last_spend_sync_at, lastError: acct.last_error } : null,
    setupMissing,
    days,
    ...buildAdPerformance(spend, leads, jobs),
  };
}
