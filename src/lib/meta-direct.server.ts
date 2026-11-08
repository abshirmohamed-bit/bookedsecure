import { z } from 'zod';
import { cleanAttribution, computeSince, syncLeadSchema, type SyncLeadInput } from './lead-sync';
import { decryptMetaToken, readMetaAppConfig, tokenContext } from './meta-oauth.server';

/**
 * Direct Facebook Lead Ads import: BookedSecure reads a business's lead forms
 * from the Graph API itself, every five minutes. Leads go through the shared
 * runs/items/checkpoints pipeline: dedupe, enrichment, auto-replies, owner alerts.
 *
 * Each business connects its own Page in Settings; the Page token is stored
 * encrypted per business (meta_lead_accounts) and only ever read server-side.
 */
export type DirectMetaAccount = {
  businessId: string;
  pageId: string;
  pageName: string | null;
  token: string;
  /** Forms the owner chose. Empty means every active form on the Page. */
  formIds: string[];
};

/** Loads and decrypts the business's own Facebook connection. */
export async function loadMetaAccount(businessId: string): Promise<DirectMetaAccount> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.from('meta_lead_accounts')
    .select('business_id, page_id, page_name, token_ciphertext, form_ids').eq('business_id', businessId).maybeSingle();
  if (error) throw new Error('Could not load the Facebook connection.');
  if (!data?.page_id || !data.token_ciphertext) throw new Error('Facebook is not connected. Connect your Facebook Page in Settings first.');
  return {
    businessId, pageId: data.page_id, pageName: data.page_name,
    token: decryptMetaToken(data.token_ciphertext, tokenContext(businessId, data.page_id)),
    formIds: data.form_ids ?? [],
  };
}

/** Attribution fields requested with every lead. Dropped automatically if the token may not read them. */
export const LEAD_AD_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,is_organic';
const adFields = { ad_id: z.string().optional(), ad_name: z.string().optional(), adset_id: z.string().optional(), adset_name: z.string().optional(), campaign_id: z.string().optional(), campaign_name: z.string().optional(), platform: z.string().optional(), is_organic: z.boolean().optional() };
const leadPage = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+$/), created_time: z.string(), field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })), ...adFields })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});
const formPage = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().optional(), status: z.string().optional() })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});
const graphError = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }) });

export type MetaForm = { id: string; name: string; status: string };

/** Turns a Graph API failure into a controlled, owner-readable message. Never echoes the body. */
export function describeGraphFailure(status: number, body: unknown): string {
  const parsed = graphError.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (code === 190) return 'The Facebook connection has expired or was revoked. Reconnect Facebook in Settings.';
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return 'Facebook is rate-limiting requests. The next check will try again.';
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300) || status === 401 || status === 403) {
    return `Facebook refused access (${status}). Reconnect Facebook with lead access for this Page, and check the Page's Leads Access allows BookedSecure.`;
  }
  if (code === 100) return `Facebook rejected the request (${status}). Check the lead form still exists on the connected Page.`;
  return `Facebook read failed (${status}). No import checkpoint was advanced.`;
}

/** Never log provider bodies, thrown fetch errors, next URLs or headers: any
 * of them may echo a token. Only controlled status/code diagnostics escape.
 */
const singleLead = z.object({ id: z.string().regex(/^\d+$/), created_time: z.string(), form_id: z.string().regex(/^\d+$/).optional(), field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })), ...adFields });

/** A Graph failure that keeps Facebook's numeric code for callers that can recover. */
class GraphReadError extends Error { constructor(message: string, readonly status: number, readonly code?: number) { super(message); } }
const subscribedApps = z.object({ data: z.array(z.object({ id: z.string().optional(), subscribed_fields: z.array(z.string()).optional() })) });

export function createDirectMetaTransport(account: DirectMetaAccount, version = readMetaAppConfig().version, fetcher: typeof fetch = fetch) {
  async function get(path: string, params: Record<string, string>, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await fetcher(url, { method, headers: { Authorization: `Bearer ${account.token}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    } catch { throw new Error('Facebook could not be reached. No import checkpoint was advanced.'); }
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok || (body && typeof body === 'object' && 'error' in body)) {
      const parsed = graphError.safeParse(body);
      throw new GraphReadError(describeGraphFailure(response.status, body), response.status, parsed.success ? parsed.data.error.code : undefined);
    }
    if (body === null) throw new Error('Facebook returned an invalid response.');
    return body;
  }

  /** Every lead form on the connected Page (any status). */
  async function listForms(): Promise<MetaForm[]> {
    const forms: MetaForm[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const parsed = formPage.safeParse(await get(`${account.pageId}/leadgen_forms`, { fields: 'id,name,status', limit: '100', ...(after ? { after } : {}) }));
      if (!parsed.success) throw new Error('Facebook returned invalid lead form information.');
      for (const f of parsed.data.data) forms.push({ id: f.id, name: f.name ?? f.id, status: f.status ?? 'UNKNOWN' });
      if (!parsed.data.paging?.next) return forms;
      after = parsed.data.paging.cursors?.after;
      if (!after || seen.has(after)) throw new Error('Facebook form pagination could not be completed.');
      seen.add(after);
    }
    throw new Error('Facebook form pagination exceeded the safe limit.');
  }

  /** The forms to import: the owner's selection, or every active form when none is selected. */
  async function resolveForms(): Promise<MetaForm[]> {
    const all = await listForms();
    if (!account.formIds.length) return all.filter((f) => f.status === 'ACTIVE');
    const byId = new Map(all.map((f) => [f.id, f]));
    const missing = account.formIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error('A selected lead form is no longer on the connected Facebook Page. Update the form selection in Settings.');
    return account.formIds.map((id) => byId.get(id)!);
  }

  // Attribution needs ad permissions; if Facebook refuses those fields, keep importing without them.
  // Once a read with attribution has worked, later failures are real and are not retried.
  let withAdFields = true; let adFieldsConfirmed = false;
  async function getLeadData(path: string, params: Record<string, string>, base: string) {
    if (withAdFields) {
      try {
        const body = await get(path, { ...params, fields: `${base},${LEAD_AD_FIELDS}` });
        adFieldsConfirmed = true;
        return body;
      } catch (e) {
        const permission = e instanceof GraphReadError && ([10, 100, 200].includes(e.code ?? -1) || e.status === 403);
        if (adFieldsConfirmed || !permission) throw e;
        withAdFields = false;
      }
    }
    return get(path, { ...params, fields: base });
  }

  async function readPage(formId: string, since: Date, until: Date, after?: string, limit = 100) {
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until || until.getTime() - since.getTime() > 90 * 86400_000) {
      throw new Error('A valid date range of at most 90 days is required.');
    }
    // Server-side time filter keeps each read small; local bounds are enforced too.
    const parsed = leadPage.safeParse(await getLeadData(`${formId}/leads`, {
      limit: String(limit),
      filtering: JSON.stringify([
        { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) - 1 },
        { field: 'time_created', operator: 'LESS_THAN', value: Math.ceil(until.getTime() / 1000) + 1 },
      ]), ...(after ? { after } : {}),
    }, 'id,created_time,field_data'));
    if (!parsed.success) throw new Error('Facebook returned incomplete lead IDs, timestamps or form answers.');
    return parsed.data;
  }

  /** Read-only probe: the Page's forms plus one bounded leads read per form. Nothing is saved. */
  async function testAccess(now = new Date(), appId?: string) {
    const forms = await resolveForms();
    if (!forms.length) throw new Error('The connected Facebook Page has no active lead forms.');
    for (const f of forms) await readPage(f.id, new Date(now.getTime() - 86400_000), now, undefined, 1);
    const instant = appId ? await instantLeadsOn(appId).catch(() => null) : null;
    return { healthy: true as const, checkedAt: now.toISOString(), formCount: forms.length, pageName: account.pageName, instant };
  }

  /** One lead by id (what a Facebook webhook announces). */
  async function readLead(leadId: string): Promise<SyncLeadInput & { form_id: string }> {
    if (!/^\d{3,40}$/.test(leadId)) throw new Error('Facebook sent an invalid lead id.');
    const parsed = singleLead.safeParse(await getLeadData(leadId, {}, 'id,created_time,form_id,field_data'));
    if (!parsed.success || !parsed.data.form_id) throw new Error('Facebook returned an incomplete lead.');
    const lead = syncLeadSchema.safeParse({ meta_lead_id: parsed.data.id, created_time: parsed.data.created_time, field_data: parsed.data.field_data, form_id: parsed.data.form_id, page_id: account.pageId, ad: cleanAttribution(parsed.data) });
    if (!lead.success) throw new Error('A Facebook submission exceeds the importer’s safe field limits; no answers were truncated.');
    return { ...lead.data, form_id: parsed.data.form_id };
  }

  /** Whether this Page sends BookedSecure's app a webhook for every new lead. */
  async function instantLeadsOn(appId: string): Promise<boolean> {
    const parsed = subscribedApps.safeParse(await get(`${account.pageId}/subscribed_apps`, { fields: 'id,subscribed_fields' }));
    if (!parsed.success) throw new Error('Facebook returned invalid subscription information.');
    return parsed.data.data.some((a) => a.id === appId && (a.subscribed_fields ?? []).includes('leadgen'));
  }

  /** Asks Facebook to notify BookedSecure the moment a lead is submitted on this Page. */
  async function subscribeInstantLeads() {
    // leadgen = new leads; feed = comments; messages = Messenger DMs.
    await get(`${account.pageId}/subscribed_apps`, { subscribed_fields: 'leadgen,feed,messages' }, 'POST');
  }

  async function unsubscribeInstantLeads() {
    await get(`${account.pageId}/subscribed_apps`, {}, 'DELETE');
  }

  async function importLeads(options: {
    lookbackDays: number; checkpoints: { form_id: string; last_submitted_at: string }[];
    now?: Date;
    apply: (batch: { leads: SyncLeadInput[]; final: boolean; error?: string }) => Promise<unknown>;
  }) {
    const now = options.now ?? new Date();
    let received = 0;
    const seen = new Set<string>();
    try {
      const forms = await resolveForms();
      for (const form of forms) {
        const cp = options.checkpoints.find((c) => c.form_id === form.id);
        const lower = computeSince(cp?.last_submitted_at ?? null, options.lookbackDays, now);
        // Meta keeps leads for 90 days, so nothing older can be read anyway.
        const since = new Date(Math.max(lower.getTime(), now.getTime() - 90 * 86400_000 + 60_000));
        const cursors = new Set<string>();
        let after: string | undefined;
        let finished = false;
        for (let page = 0; page < 50; page++) {
          const result = await readPage(form.id, since, now, after);
          const leads: SyncLeadInput[] = [];
          for (const row of result.data) {
            const timestamp = Date.parse(row.created_time);
            if (!Number.isFinite(timestamp)) throw new Error('Facebook returned an invalid submission timestamp.');
            if (timestamp < since.getTime() || timestamp > now.getTime() || seen.has(row.id)) continue;
            const parsed = syncLeadSchema.safeParse({ meta_lead_id: row.id, created_time: row.created_time, field_data: row.field_data, form_id: form.id, form_name: form.name, page_id: account.pageId, ad: cleanAttribution(row) });
            if (!parsed.success) throw new Error('A Facebook submission exceeds the importer’s safe field limits; no answers were truncated.');
            seen.add(row.id); leads.push(parsed.data);
          }
          if (leads.length) { await options.apply({ leads, final: false }); received += leads.length; }
          if (!result.paging?.next) { finished = true; break; }
          after = result.paging.cursors?.after;
          if (!after || cursors.has(after)) throw new Error('Facebook lead pagination could not be completed.');
          cursors.add(after);
        }
        if (!finished) throw new Error('Facebook lead pagination exceeded the safe limit.');
      }
      const result = await options.apply({ leads: [], final: true });
      return { received, result };
    } catch (e) {
      // Only our controlled messages enter history; never raw fetch/provider data.
      const message = e instanceof Error ? e.message : 'Direct Facebook import could not complete.';
      await options.apply({ leads: [], final: true, error: message });
      throw new Error(message);
    }
  }
  return { listForms, testAccess, importLeads, readLead, instantLeadsOn, subscribeInstantLeads, unsubscribeInstantLeads };
}
