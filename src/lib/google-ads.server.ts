/**
 * Google Ads for each business, through the official Google Ads API, read only.
 *
 * The owner signs in with Google (the same Google Cloud client as YouTube,
 * scope adwords); only the encrypted refresh token is kept, bound to the
 * business, in server-only google_ads_accounts. Platform settings:
 * Google_Console_Client_ID / _Secret (shared with YouTube),
 * GOOGLE_ADS_DEVELOPER_TOKEN (from the Google Ads API Center of a manager
 * account), optional GOOGLE_ADS_LOGIN_CUSTOMER_ID (that manager account, when
 * the business's account is reached through it) and GOOGLE_ADS_API_VERSION.
 *
 * Spend syncs per campaign per day: 90 days the first time, then the last 3
 * (Google still adjusts recent days), hourly from the follow-ups hook.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptMetaToken, encryptMetaToken } from "./meta-oauth.server";
import { readYouTubeConfig, sign, verify } from "./youtube.server";
import {
  buildGoogleAdsAuthorizeUrl, campaignDailyQuery, DEFAULT_GOOGLE_ADS_API_VERSION, formatCustomerId, GOOGLE_ADS_CALLBACK_PATH, GOOGLE_ADS_SCOPE,
  type GoogleSearchRow, type GoogleSpendRow, isGoogleAdVisit, isoDay, matchCampaign, normaliseCustomerId, toSpendRow,
} from "./google-ads";
import { buildAdPerformance, type JobRow, type LeadRow } from "./meta-ads";

const FIRST_SYNC_DAYS = 90;
const RESYNC_DAYS = 3;
const SYNC_EVERY_MS = 60 * 60_000;
const STATE_TTL_MS = 15 * 60_000;
const refreshContext = (b: string) => `google-ads:${b}`;
const accessContext = (b: string) => `google-ads-access:${b}`;
const missingTable = (code?: string) => code === "PGRST205" || code === "42P01";

export type GoogleAdsAccountChoice = { id: string; name: string; currency: string | null; manager: boolean };

function settings() {
  const yt = readYouTubeConfig();
  return {
    clientId: yt.clientId, clientSecret: yt.clientSecret, appUrl: yt.appUrl,
    developerToken: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]?.trim() || undefined,
    loginCustomerId: normaliseCustomerId(process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]),
    version: (process.env["GOOGLE_ADS_API_VERSION"]?.trim() || DEFAULT_GOOGLE_ADS_API_VERSION).replace(/[^a-z0-9]/gi, ""),
  };
}

/** Names (never values) of the platform settings Google Ads still needs. */
export function googleAdsMissingSettings(): string[] {
  const s = settings();
  return [
    s.clientId ? null : "Google_Console_Client_ID",
    s.clientSecret ? null : "Google_Console_Client_Secret",
    s.developerToken ? null : "GOOGLE_ADS_DEVELOPER_TOKEN",
    process.env["TENANT_AI_ENCRYPTION_SECRET"] ? null : "TENANT_AI_ENCRYPTION_SECRET",
  ].filter((n): n is string => n !== null);
}

function assertReady() {
  const missing = googleAdsMissingSettings();
  if (missing.length) throw new Error(`Google Ads isn't set up on BookedSecure yet (${missing.join(", ")}).`);
}

export function googleAdsLoginUrl(businessId: string, userId: string): string {
  assertReady();
  const s = settings();
  return buildGoogleAdsAuthorizeUrl({
    clientId: s.clientId!, redirectUri: `${s.appUrl}${GOOGLE_ADS_CALLBACK_PATH}`,
    state: sign("google-ads-oauth-state", { b: businessId, u: userId, e: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString("hex") }),
  });
}

const tokenResponse = z.object({ access_token: z.string().min(10), expires_in: z.number().optional(), refresh_token: z.string().optional(), scope: z.string().optional() });

async function googleFetch(url: string, init: RequestInit, step: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(`Google Ads could not be reached (${step}). Please try again.`);
  }
}

function apiHeaders(token: string, loginCustomerId: string | null): Record<string, string> {
  const s = settings();
  return {
    Authorization: `Bearer ${token}`, "developer-token": s.developerToken!, "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

/** A readable reason from a Google Ads error body, never tokens. */
async function apiProblem(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; details?: Array<{ errors?: Array<{ message?: string; errorCode?: Record<string, string> }> }> } } | null;
  const inner = body?.error?.details?.[0]?.errors?.[0];
  const code = inner?.errorCode ? Object.values(inner.errorCode)[0] : null;
  if (code === "DEVELOPER_TOKEN_NOT_APPROVED") return "The Google Ads developer token is only approved for test accounts. Apply for Basic access in the Google Ads API Center.";
  if (code === "USER_PERMISSION_DENIED") return "This Google sign-in can't see that Google Ads account. Sign in with a user on the account, or set GOOGLE_ADS_LOGIN_CUSTOMER_ID to its manager account.";
  if (res.status === 401) return "Google Ads signed you out. Reconnect Google Ads.";
  return (inner?.message ?? body?.error?.message ?? `Google Ads refused the request (${res.status}).`).slice(0, 300);
}

async function searchAll(token: string, customerId: string, loginCustomerId: string | null, query: string): Promise<GoogleSearchRow[]> {
  const s = settings();
  const out: GoogleSearchRow[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await googleFetch(`https://googleads.googleapis.com/${s.version}/customers/${customerId}/googleAds:search`, {
      method: "POST", headers: apiHeaders(token, loginCustomerId), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    }, "search");
    if (!res.ok) throw new Error(await apiProblem(res));
    const body = (await res.json().catch(() => ({}))) as { results?: GoogleSearchRow[]; nextPageToken?: string };
    out.push(...(body.results ?? []));
    pageToken = body.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

/** The accounts this sign-in can see, with names, currencies and whether each is a manager. */
async function listAccounts(token: string): Promise<GoogleAdsAccountChoice[]> {
  const s = settings();
  const res = await googleFetch(`https://googleads.googleapis.com/${s.version}/customers:listAccessibleCustomers`, { method: "GET", headers: apiHeaders(token, null) }, "accounts");
  if (!res.ok) throw new Error(await apiProblem(res));
  const body = (await res.json().catch(() => ({}))) as { resourceNames?: string[] };
  const ids = (body.resourceNames ?? []).map((r) => normaliseCustomerId(r.split("/").pop())).filter((x): x is string => Boolean(x)).slice(0, 20);
  const out: GoogleAdsAccountChoice[] = [];
  for (const id of ids) {
    try {
      const rows = await searchAll(token, id, s.loginCustomerId, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1");
      const c = (rows[0] as { customer?: { descriptiveName?: string; currencyCode?: string; manager?: boolean } } | undefined)?.customer;
      out.push({ id, name: c?.descriptiveName || formatCustomerId(id), currency: c?.currencyCode ?? null, manager: Boolean(c?.manager) });
    } catch {
      out.push({ id, name: formatCustomerId(id), currency: null, manager: false });
    }
  }
  return out;
}

/** Finishes the Google sign-in, stores the token and picks the account to report on. */
export async function completeGoogleAdsConnect(code: string, state: string): Promise<"connected" | "choose"> {
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), e: z.number() }).safeParse(verify("google-ads-oauth-state", state));
  if (!parsed.success || parsed.data.e < Date.now()) throw new Error("This Google Ads sign-in link has expired. Please connect again.");
  const who = { businessId: parsed.data.b, userId: parsed.data.u };
  const { requireAppContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireAppContext(supabaseAdmin, who.userId);
  requireOwner(ctx);
  if (ctx.businessId !== who.businessId) throw new Error("This Google Ads sign-in belongs to a different business.");
  assertReady();
  const s = settings();
  const tokenRes = await googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${s.appUrl}${GOOGLE_ADS_CALLBACK_PATH}`, client_id: s.clientId!, client_secret: s.clientSecret! }),
  }, "token");
  const token = tokenResponse.safeParse(tokenRes.ok ? await tokenRes.json().catch(() => null) : null);
  if (!token.success) throw new Error("Google did not accept the sign-in. Please try again.");
  if (!(token.data.scope ?? "").includes(GOOGLE_ADS_SCOPE)) throw new Error("Please allow \"See, edit, create and delete your Google Ads accounts\" when Google asks. BookedSecure only reads figures.");
  if (!token.data.refresh_token) throw new Error("Google didn't give lasting access. Remove BookedSecure from your Google account's third-party access, then connect again.");
  const accounts = (await listAccounts(token.data.access_token)).filter((a) => !a.manager);
  const chosen = accounts.length === 1 ? accounts[0]! : null;
  const now = new Date();
  const { error } = await supabaseAdmin.from("google_ads_accounts").upsert({
    business_id: who.businessId,
    customer_id: chosen?.id ?? null, customer_name: chosen?.name ?? null, currency: chosen?.currency ?? null,
    login_customer_id: s.loginCustomerId, available_accounts: accounts as never,
    refresh_token_ciphertext: encryptMetaToken(token.data.refresh_token, refreshContext(who.businessId)),
    access_token_ciphertext: encryptMetaToken(token.data.access_token, accessContext(who.businessId)),
    access_token_expires_at: new Date(now.getTime() + (token.data.expires_in ?? 3600) * 1000).toISOString(),
    connected_by: who.userId, connected_at: now.toISOString(), last_sync_at: null, last_error: accounts.length ? null : "No Google Ads accounts were found for this sign-in.", updated_at: now.toISOString(),
  }, { onConflict: "business_id" });
  if (error) throw new Error(missingTable(error.code) ? "Google Ads is waiting for a one-time database update (migration 0062)." : "Could not save the Google Ads connection.");
  await supabaseAdmin.from("audit_events").insert({ business_id: who.businessId, user_id: who.userId, event_type: "google_ads_connected", entity_type: "business", entity_id: who.businessId, metadata: { accounts: accounts.length } });
  if (chosen) await syncGoogleAdSpend(who.businessId).catch(() => undefined);
  return chosen ? "connected" : "choose";
}

type AccountRow = { customer_id: string | null; login_customer_id: string | null; refresh_token_ciphertext: string; access_token_ciphertext: string | null; access_token_expires_at: string | null; last_sync_at: string | null };

async function accessToken(businessId: string, account: AccountRow): Promise<string> {
  const expires = account.access_token_expires_at ? Date.parse(account.access_token_expires_at) : 0;
  if (account.access_token_ciphertext && expires - Date.now() > 3 * 60_000) {
    try { return decryptMetaToken(account.access_token_ciphertext, accessContext(businessId)); } catch { /* refresh below */ }
  }
  const s = settings();
  let refresh: string;
  try { refresh = decryptMetaToken(account.refresh_token_ciphertext, refreshContext(businessId)); } catch { throw new Error("Google Ads needs to be reconnected."); }
  const res = await googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: s.clientId!, client_secret: s.clientSecret! }),
  }, "refresh");
  const body = tokenResponse.safeParse(res.ok ? await res.json().catch(() => null) : null);
  if (!body.success) throw new Error(res.status === 400 || res.status === 401 ? "Google Ads signed you out. Reconnect Google Ads." : `Google couldn't renew Google Ads access (${res.status}).`);
  await supabaseAdmin.from("google_ads_accounts").update({
    access_token_ciphertext: encryptMetaToken(body.data.access_token, accessContext(businessId)),
    access_token_expires_at: new Date(Date.now() + (body.data.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("business_id", businessId);
  return body.data.access_token;
}

/** Pulls cost, clicks, impressions and conversions per campaign per day. */
export async function syncGoogleAdSpend(businessId: string, now = new Date()): Promise<{ rows: number }> {
  assertReady();
  const { data: account, error } = await supabaseAdmin.from("google_ads_accounts")
    .select("customer_id, login_customer_id, refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at, last_sync_at").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(missingTable(error.code) ? "Google Ads is waiting for a one-time database update (migration 0062)." : "Could not load the Google Ads connection.");
  if (!account) throw new Error("Google Ads isn't connected.");
  if (!account.customer_id) throw new Error("Choose which Google Ads account to report on.");
  try {
    const token = await accessToken(businessId, account as AccountRow);
    const days = account.last_sync_at ? RESYNC_DAYS : FIRST_SYNC_DAYS;
    const query = campaignDailyQuery(isoDay(new Date(now.getTime() - (days - 1) * 86400_000)), isoDay(now));
    const rows = (await searchAll(token, account.customer_id, account.login_customer_id, query)).map(toSpendRow).filter((r): r is GoogleSpendRow => r !== null);
    if (rows.length) {
      const { error: upErr } = await supabaseAdmin.from("google_ad_spend_daily").upsert(
        rows.map((r) => ({ ...r, business_id: businessId, customer_id: account.customer_id!, updated_at: now.toISOString() })),
        { onConflict: "business_id,campaign_id,date" },
      );
      if (upErr) throw new Error("Could not save Google Ads figures.");
    }
    await supabaseAdmin.from("google_ads_accounts").update({ last_sync_at: now.toISOString(), last_error: null }).eq("business_id", businessId);
    return { rows: rows.length };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Google Ads figures could not be loaded.";
    await supabaseAdmin.from("google_ads_accounts").update({ last_error: reason, last_sync_at: now.toISOString() }).eq("business_id", businessId);
    throw new Error(reason);
  }
}

/** Hourly, from the follow-ups hook. A missing table or one failing business never stops the rest. */
export async function sweepGoogleAdSpend(now = new Date()): Promise<{ synced: number }> {
  if (googleAdsMissingSettings().length) return { synced: 0 };
  const { data, error } = await supabaseAdmin.from("google_ads_accounts").select("business_id, last_sync_at").not("customer_id", "is", null).limit(200);
  if (error) return { synced: 0 };
  let synced = 0;
  for (const a of data ?? []) {
    if (a.last_sync_at && now.getTime() - Date.parse(a.last_sync_at) < SYNC_EVERY_MS) continue;
    try { await syncGoogleAdSpend(a.business_id, now); synced++; } catch { /* recorded on the account */ }
  }
  return { synced };
}

export async function chooseGoogleAdsAccount(businessId: string, customerId: string) {
  const { data: account } = await supabaseAdmin.from("google_ads_accounts").select("available_accounts").eq("business_id", businessId).maybeSingle();
  const choices = z.array(z.object({ id: z.string(), name: z.string(), currency: z.string().nullable(), manager: z.boolean() })).catch([]).parse(account?.available_accounts);
  const pick = choices.find((c) => c.id === customerId);
  if (!pick) throw new Error("That account isn't one this Google sign-in can see.");
  const { error } = await supabaseAdmin.from("google_ads_accounts").update({ customer_id: pick.id, customer_name: pick.name, currency: pick.currency, last_sync_at: null, last_error: null, updated_at: new Date().toISOString() }).eq("business_id", businessId);
  if (error) throw new Error("Could not change the Google Ads account.");
  return pick;
}

export async function disconnectGoogleAds(businessId: string, userId: string) {
  await supabaseAdmin.from("google_ads_accounts").delete().eq("business_id", businessId);
  await supabaseAdmin.from("audit_events").insert({ business_id: businessId, user_id: userId, event_type: "google_ads_disconnected", entity_type: "business", entity_id: businessId, metadata: {} });
  return { ok: true };
}

/**
 * Google Ads results for the last `days` days: spend and clicks from Google,
 * leads, bookings, completed jobs and revenue from BookedSecure, joined
 * through the quote-page visit each lead came from.
 */
export async function googleAdPerformance(businessId: string, days: number, now = new Date()) {
  const missing = googleAdsMissingSettings();
  const { data: acct, error: acctErr } = await supabaseAdmin.from("google_ads_accounts")
    .select("customer_id, customer_name, currency, available_accounts, last_sync_at, last_error").eq("business_id", businessId).maybeSingle();
  const setupMissing = Boolean(acctErr && missingTable(acctErr.code));
  if (acctErr && !setupMissing) throw new Error("Could not load the Google Ads connection.");
  const sinceDate = new Date(now.getTime() - (days - 1) * 86400_000);
  const since = isoDay(sinceDate);
  const spendRes = acct?.customer_id
    ? await supabaseAdmin.from("google_ad_spend_daily").select("campaign_id, campaign_name, date, spend, clicks, impressions, conversions").eq("business_id", businessId).eq("customer_id", acct.customer_id).gte("date", since).limit(5000)
    : { data: [], error: null };
  if (spendRes.error && !missingTable(spendRes.error.code)) throw new Error("Could not load Google Ads figures.");
  const spendRows = spendRes.data ?? [];
  const known = [...new Map(spendRows.map((s) => [s.campaign_id, { id: s.campaign_id, name: s.campaign_name }])).values()];

  // Leads that arrived through a quote-page visit carrying a Google ad click.
  const { data: visits } = await supabaseAdmin.from("quote_page_events").select("conversation_id, source, medium, campaign, utm, created_at")
    .eq("business_id", businessId).gte("created_at", sinceDate.toISOString()).not("conversation_id", "is", null).limit(10000);
  const adVisits = (visits ?? []).filter(isGoogleAdVisit);
  const campaignOfConversation = new Map<string, string | null>();
  for (const v of adVisits) if (v.conversation_id && !campaignOfConversation.has(v.conversation_id)) campaignOfConversation.set(v.conversation_id, v.campaign);
  const conversationIds = [...campaignOfConversation.keys()];
  const leads: LeadRow[] = [];
  for (let i = 0; i < conversationIds.length; i += 200) {
    const { data } = await supabaseAdmin.from("web_conversations").select("id, lead_id").eq("business_id", businessId).in("id", conversationIds.slice(i, i + 200)).not("lead_id", "is", null);
    for (const c of data ?? []) {
      if (!c.lead_id || leads.some((l) => l.id === c.lead_id)) continue;
      const m = matchCampaign(campaignOfConversation.get(c.id) ?? null, known);
      leads.push({ id: c.lead_id, campaign_id: m.id, campaign_name: m.name });
    }
  }
  const liveLeads: LeadRow[] = [];
  for (let i = 0; i < leads.length; i += 200) {
    const { data } = await supabaseAdmin.from("leads").select("id").eq("business_id", businessId).is("deleted_at", null).in("id", leads.slice(i, i + 200).map((l) => l.id));
    const ok = new Set((data ?? []).map((l) => l.id));
    liveLeads.push(...leads.slice(i, i + 200).filter((l) => ok.has(l.id)));
  }
  const jobs: JobRow[] = [];
  for (let i = 0; i < liveLeads.length; i += 200) {
    const { data, error } = await supabaseAdmin.from("jobs").select("lead_id, scheduled_at, completion_status, completed_value").eq("business_id", businessId).in("lead_id", liveLeads.slice(i, i + 200).map((l) => l.id));
    if (error) throw new Error("Could not load jobs.");
    for (const j of data ?? []) if (j.lead_id) jobs.push({ lead_id: j.lead_id, scheduled_at: j.scheduled_at, completion_status: j.completion_status, completed_value: j.completed_value === null ? null : Number(j.completed_value) });
  }
  const spend = spendRows.map((s) => ({ campaign_id: s.campaign_id, campaign_name: s.campaign_name, date: s.date, spend: Number(s.spend) || 0, meta_leads: 0, clicks: s.clicks, impressions: s.impressions }));
  const conversions = Math.round(spendRows.reduce((n, s) => n + (Number(s.conversions) || 0), 0) * 100) / 100;
  return {
    platformMissing: missing,
    account: acct ? {
      id: acct.customer_id, name: acct.customer_name, currency: acct.currency, lastSyncAt: acct.last_sync_at, lastError: acct.last_error,
      choices: z.array(z.object({ id: z.string(), name: z.string() })).catch([]).parse(acct.available_accounts),
    } : null,
    setupMissing, days, googleConversions: conversions,
    ...buildAdPerformance(spend, liveLeads, jobs),
  };
}
