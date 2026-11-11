import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';

type Row = Record<string, unknown>;
type Db = { from: (t: string) => { select: (c: string) => Query } };
type Query = {
  eq: (c: string, v: string) => Query;
  neq: (c: string, v: string) => Query;
  order: (c: string, o: { ascending: boolean }) => Query;
  limit: (n: number) => Promise<{ data: Row[] | null; error: { code?: string } | null }>;
};

/** Caller-scoped read of the latest Lead finder search (row-level security keeps it to the caller's business). */
export default defineTool({
  name: 'lead_finder_results', title: 'Lead finder results',
  description: 'The latest Lead finder search and its businesses: fit (good, maybe, unknown), why, the email they publish and its check, phone, website, and whether each was already added to customers. Read-only.',
  inputSchema: {}, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const db = client as unknown as Db;
    const { data: searches, error } = await db.from('lead_finder_searches').select('id,query,area,criteria,status,found_count,created_at')
      .eq('business_id', businessId).order('created_at', { ascending: false }).limit(5);
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') return jsonResult({ searches: [], results: [], note: 'Lead finder is waiting for a one-time BookedSecure update.' });
      throw new ToolError('Lead finder results could not be read.');
    }
    const latest = (searches ?? [])[0];
    let rows: Row[] = [];
    if (latest) {
      const res = await db.from('lead_finder_prospects').select('id,name,suburb,fit,fit_reason,email,email_status,phone,website,status')
        .eq('business_id', businessId).eq('search_id', String(latest['id'])).neq('status', 'dismissed').order('created_at', { ascending: true }).limit(50);
      if (res.error) throw new ToolError('Lead finder results could not be read.');
      rows = res.data ?? [];
    }
    return jsonResult({
      searches: (searches ?? []).map((s) => ({ what: s['query'], where: s['area'], criteria: s['criteria'], found: s['found_count'], status: s['status'], at: s['created_at'] })),
      results: rows.map((r) => ({ id: r['id'], name: r['name'], suburb: r['suburb'], fit: r['fit'], why: r['fit_reason'], email: r['email'], emailCheck: r['email_status'], phone: r['phone'], website: r['website'], added: r['status'] === 'added' })),
    });
  },
});
