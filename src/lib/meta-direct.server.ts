import { z } from 'zod';
import { computeSince, syncLeadSchema, type SyncLeadInput } from './lead-sync';

/**
 * Direct Facebook Lead Ads import: BookedSecure reads the Page's lead forms from
 * the Meta Graph API itself, replacing the Make scenario (which costs Make
 * credits on every five-minute run). It feeds the exact same runs/items/
 * checkpoints pipeline as Make, so dedupe, enrichment, auto-replies and owner
 * alerts are unchanged.
 *
 * The server credential belongs to one Page, so it is bound to one business and
 * to the same Page/form the Make blueprint was approved for. Another tenant can
 * never use it, whatever it stores in its own connection row.
 */
export const DIRECT_META_ALLOWLIST = Object.freeze({
  businessId: '11111111-1111-1111-1111-111111111111',
  pageId: '383114254879346',
  forms: Object.freeze({ '38813647781617096': 'Glocast-copy-copy-copy' }) as Readonly<Record<string, string>>,
  formIds: ['38813647781617096'] as readonly string[],
});

/** Used when META_DIRECT_GRAPH_VERSION is not set. Override it without a code change. */
export const DEFAULT_GRAPH_VERSION = 'v23.0';

export type DirectMetaConfig = { token?: string | undefined; version: string };

export function readDirectMetaConfig(): DirectMetaConfig {
  // Dedicated server secret only. Never borrow Make, API-key, MCP, connector or
  // browser credentials. Values are read only inside server calls.
  const token = process.env['META_DIRECT_GLOCAST_ACCESS_TOKEN']?.trim() || undefined;
  const version = process.env['META_DIRECT_GRAPH_VERSION']?.trim() || DEFAULT_GRAPH_VERSION;
  return { token, version };
}

export function isDirectMetaBusiness(businessId: string): boolean {
  return businessId === DIRECT_META_ALLOWLIST.businessId;
}

export function assertDirectMetaScope(businessId: string, config: DirectMetaConfig) {
  if (!isDirectMetaBusiness(businessId)) throw new Error('Direct Facebook import is not available for this account.');
  if (!config.token) throw new Error('The Facebook access token has not been added yet (META_DIRECT_GLOCAST_ACCESS_TOKEN). A BookedSecure API key cannot read Facebook leads.');
  if (!/^v\d+\.\d+$/.test(config.version)) throw new Error('META_DIRECT_GRAPH_VERSION must look like v23.0.');
}

const leadPage = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+$/), created_time: z.string(), field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })) })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});

const graphError = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }) });

/** Turns a Graph API failure into a controlled, owner-readable message. Never echoes the body. */
export function describeGraphFailure(status: number, body: unknown): string {
  const parsed = graphError.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (code === 190) return 'The Facebook access token has expired or was revoked. Create a new one and update META_DIRECT_GLOCAST_ACCESS_TOKEN.';
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return 'Facebook is rate-limiting requests. The next check will try again.';
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300) || status === 401 || status === 403) {
    return `Facebook refused access (${status}). The token needs leads_retrieval for the Glocast Page, and the Page's Leads Access must allow the app.`;
  }
  if (code === 100) return `Facebook rejected the request (${status}). Check the form still exists and META_DIRECT_GRAPH_VERSION is supported.`;
  return `Facebook read failed (${status}). No import checkpoint was advanced.`;
}

/** Never log provider bodies, thrown fetch errors, next URLs or headers: any
 * of them may echo a token. Only controlled status/code diagnostics escape.
 */
export function createDirectMetaTransport(config: DirectMetaConfig, fetcher: typeof fetch = fetch) {
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch { throw new Error('Facebook could not be reached. No import checkpoint was advanced.'); }
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok || (body && typeof body === 'object' && 'error' in body)) throw new Error(describeGraphFailure(response.status, body));
    if (body === null) throw new Error('Facebook returned an invalid response.');
    return body;
  }

  async function readPage(formId: string, since: Date, until: Date, after?: string, limit = 100) {
    if (!DIRECT_META_ALLOWLIST.formIds.includes(formId)) throw new Error('This Facebook form is not allowlisted.');
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until || until.getTime() - since.getTime() > 90 * 86400_000) {
      throw new Error('A valid date range of at most 90 days is required.');
    }
    // Server-side time filter keeps each read small; local bounds are enforced too.
    const parsed = leadPage.safeParse(await get(`${formId}/leads`, {
      fields: 'id,created_time,field_data', limit: String(limit),
      filtering: JSON.stringify([
        { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) - 1 },
        { field: 'time_created', operator: 'LESS_THAN', value: Math.ceil(until.getTime() / 1000) + 1 },
      ]), ...(after ? { after } : {}),
    }));
    if (!parsed.success) throw new Error('Facebook returned incomplete lead IDs, timestamps or form answers.');
    return parsed.data;
  }

  /** Read-only probe: one bounded leads read per allowlisted form. Nothing is saved. */
  async function testAccess(businessId: string, now = new Date()) {
    assertDirectMetaScope(businessId, config);
    for (const formId of DIRECT_META_ALLOWLIST.formIds) await readPage(formId, new Date(now.getTime() - 86400_000), now, undefined, 1);
    return { healthy: true as const, checkedAt: now.toISOString(), formCount: DIRECT_META_ALLOWLIST.formIds.length };
  }

  async function importLeads(options: {
    businessId: string; lookbackDays: number; checkpoints: { form_id: string; last_submitted_at: string }[];
    now?: Date;
    apply: (batch: { leads: SyncLeadInput[]; final: boolean; error?: string }) => Promise<unknown>;
  }) {
    assertDirectMetaScope(options.businessId, config);
    const now = options.now ?? new Date();
    let received = 0;
    const seen = new Set<string>();
    try {
      for (const formId of DIRECT_META_ALLOWLIST.formIds) {
        const formName = DIRECT_META_ALLOWLIST.forms[formId] ?? formId;
        const cp = options.checkpoints.find((c) => c.form_id === formId);
        const lower = computeSince(cp?.last_submitted_at ?? null, options.lookbackDays, now);
        // Meta keeps leads for 90 days, so nothing older can be read anyway.
        const since = new Date(Math.max(lower.getTime(), now.getTime() - 90 * 86400_000 + 60_000));
        const cursors = new Set<string>();
        let after: string | undefined;
        let finished = false;
        for (let page = 0; page < 50; page++) {
          const result = await readPage(formId, since, now, after);
          const leads: SyncLeadInput[] = [];
          for (const row of result.data) {
            const timestamp = Date.parse(row.created_time);
            if (!Number.isFinite(timestamp)) throw new Error('Facebook returned an invalid submission timestamp.');
            if (timestamp < since.getTime() || timestamp > now.getTime() || seen.has(row.id)) continue;
            const parsed = syncLeadSchema.safeParse({ meta_lead_id: row.id, created_time: row.created_time, field_data: row.field_data, form_id: formId, form_name: formName, page_id: DIRECT_META_ALLOWLIST.pageId });
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
  return { testAccess, importLeads };
}
