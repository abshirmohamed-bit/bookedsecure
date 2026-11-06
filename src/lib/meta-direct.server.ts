import { z } from 'zod';
import { computeSince, syncLeadSchema, type SyncLeadInput } from './lead-sync';

/** Explicit preview exception, verified against the existing import checkpoint.
 * No credentials, enablement state or provider configuration belongs in the browser.
 */
export const DIRECT_META_ALLOWLIST = Object.freeze({
  businessId: '11111111-1111-1111-1111-111111111111',
  pageId: '383114254879346',
  formIds: ['38813647781617096'] as readonly string[],
});

// Deliberately locked for this unpublished edit. A subsequent owner-approved
// change must follow a real access test before either flag can be switched on.
export const DIRECT_META_ENABLED = false;
export const DIRECT_META_SCHEDULE_ENABLED = false;

export type DirectMetaConfig = {
  token?: string | undefined;
  version?: string | undefined;
  enabled: boolean;
  scheduleEnabled: boolean;
  preview: boolean;
};

export function isDirectMetaPreviewHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname === 'id-preview--32747b7a-7d60-4b57-a38a-e5b710c823bb.lovable.app';
}

export function readDirectMetaConfig(hostname: string): DirectMetaConfig {
  // Dedicated, approved credential only. Never borrow Make, API-key, MCP,
  // connector or browser credentials. Values are read only inside server calls.
  return {
    token: process.env['META_DIRECT_GLOCAST_ACCESS_TOKEN'],
    version: process.env['META_DIRECT_GRAPH_VERSION'],
    enabled: DIRECT_META_ENABLED,
    scheduleEnabled: DIRECT_META_SCHEDULE_ENABLED,
    preview: isDirectMetaPreviewHost(hostname),
  };
}

export function assertDirectMetaScope(businessId: string, config: DirectMetaConfig, importing = false, scheduled = false) {
  if (businessId !== DIRECT_META_ALLOWLIST.businessId) throw new Error('Direct Facebook import is not available for this account.');
  if (!config.preview) throw new Error('Direct Facebook import is restricted to the unpublished preview.');
  if (!config.token) throw new Error('An approved Meta server credential is not configured. A BookedSecure API key cannot read Facebook leads.');
  if (!config.version || !/^v\d+\.\d+$/.test(config.version)) throw new Error('An approved Meta Graph API version is not configured.');
  if (importing && !config.enabled) throw new Error('Direct Facebook import is disabled pending a genuine access test and owner approval.');
  if (scheduled && !config.scheduleEnabled) throw new Error('Direct Facebook automatic imports are disabled.');
}

const leadPage = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+$/), created_time: z.string(), field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })) })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});
const formPage = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string().optional() })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});

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
    } catch { throw new Error('Meta could not be reached. No import checkpoint was advanced.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error(`Meta access was refused (${response.status}). Check the approved credential, leads_retrieval and Page Leads Access.`);
      throw new Error(`Meta read failed (${response.status}). No import checkpoint was advanced.`);
    }
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body) throw new Error();
      return body;
    } catch { throw new Error('Meta returned an invalid or unsuccessful response.'); }
  }

  async function authorizedForms(businessId: string) {
    assertDirectMetaScope(businessId, config);
    const grants = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })) }).safeParse(await get('me/permissions', {}));
    if (!grants.success || !grants.data.data.some((p) => p.permission === 'leads_retrieval' && p.status === 'granted')) {
      throw new Error('The approved Meta credential does not establish a granted leads_retrieval permission.');
    }
    const forms = new Map<string, string>();
    const visited = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const parsed = formPage.safeParse(await get(`${DIRECT_META_ALLOWLIST.pageId}/leadgen_forms`, { fields: 'id,name', limit: '100', ...(after ? { after } : {}) }));
      if (!parsed.success) throw new Error('Meta returned invalid Page form information.');
      for (const f of parsed.data.data) if (DIRECT_META_ALLOWLIST.formIds.includes(f.id)) forms.set(f.id, f.name ?? f.id);
      if (!parsed.data.paging?.next) {
        if (forms.size !== DIRECT_META_ALLOWLIST.formIds.length) throw new Error('The authorized Glocast Page/form is absent or access is missing.');
        return forms;
      }
      after = parsed.data.paging.cursors?.after;
      if (!after || visited.has(after)) throw new Error('Meta form pagination could not be completed.');
      visited.add(after);
    }
    throw new Error('Meta form pagination exceeded the safe limit.');
  }

  async function readPage(formId: string, since: Date, until: Date, after?: string, limit = 100) {
    if (!DIRECT_META_ALLOWLIST.formIds.includes(formId)) throw new Error('This Facebook form is not allowlisted.');
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until || until.getTime() - since.getTime() > 90 * 86400_000) {
      throw new Error('A valid date range of at most 90 days is required.');
    }
    // Filtering operators must pass the configured-version access probe; no
    // unbounded fallback if Meta rejects them. Local bounds are enforced too.
    const parsed = leadPage.safeParse(await get(`${formId}/leads`, {
      fields: 'id,created_time,field_data', limit: String(limit),
      filtering: JSON.stringify([
        { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) - 1 },
        { field: 'time_created', operator: 'LESS_THAN', value: Math.ceil(until.getTime() / 1000) + 1 },
      ]), ...(after ? { after } : {}),
    }));
    if (!parsed.success) throw new Error('Meta returned incomplete lead IDs, timestamps or form answers.');
    return parsed.data;
  }

  async function testAccess(businessId: string, now = new Date()) {
    const forms = await authorizedForms(businessId);
    for (const formId of forms.keys()) await readPage(formId, new Date(now.getTime() - 86400_000), now, undefined, 1);
    // No personal data, credentials or lead values are returned or persisted.
    return { healthy: true as const, checkedAt: now.toISOString(), formCount: forms.size };
  }

  async function importLeads(options: {
    businessId: string; lookbackDays: number; checkpoints: { form_id: string; last_submitted_at: string }[];
    scheduled?: boolean; now?: Date;
    apply: (batch: { leads: SyncLeadInput[]; final: boolean; error?: string }) => Promise<unknown>;
  }) {
    assertDirectMetaScope(options.businessId, config, true, options.scheduled);
    const now = options.now ?? new Date();
    // Permission + Page/form discovery is rechecked for every execution. An old
    // health result never authorizes another tenant or a revoked credential.
    const forms = await authorizedForms(options.businessId);
    let received = 0;
    const seen = new Set<string>();
    try {
      for (const [formId, formName] of forms) {
        const cp = options.checkpoints.find((c) => c.form_id === formId);
        const lower = computeSince(cp?.last_submitted_at ?? null, options.lookbackDays, now);
        const since = new Date(Math.max(lower.getTime(), now.getTime() - 90 * 86400_000));
        const cursors = new Set<string>();
        let after: string | undefined;
        let finished = false;
        for (let page = 0; page < 50; page++) {
          const result = await readPage(formId, since, now, after);
          const leads: SyncLeadInput[] = [];
          for (const row of result.data) {
            const timestamp = Date.parse(row.created_time);
            if (!Number.isFinite(timestamp)) throw new Error('Meta returned an invalid submission timestamp.');
            if (timestamp < since.getTime() || timestamp > now.getTime() || seen.has(row.id)) continue;
            const parsed = syncLeadSchema.safeParse({ meta_lead_id: row.id, created_time: row.created_time, field_data: row.field_data, form_id: formId, form_name: formName, page_id: DIRECT_META_ALLOWLIST.pageId });
            if (!parsed.success) throw new Error('A Meta submission exceeds the importer’s safe field limits; no answers were truncated.');
            seen.add(row.id); leads.push(parsed.data);
          }
          if (leads.length) { await options.apply({ leads, final: false }); received += leads.length; }
          if (!result.paging?.next) { finished = true; break; }
          after = result.paging.cursors?.after;
          if (!after || cursors.has(after)) throw new Error('Meta lead pagination could not be completed.');
          cursors.add(after);
        }
        if (!finished) throw new Error('Meta lead pagination exceeded the safe limit.');
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