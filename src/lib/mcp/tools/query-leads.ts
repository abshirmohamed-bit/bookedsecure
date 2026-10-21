import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { LEAD_STATUSES, SOURCE_CHANNELS } from '@/lib/domain';
import { SMS_LEAD_FILTERS } from '@/lib/sms/delivery';
import { queryLeadInbox } from '@/lib/lead-query.server';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'query_leads', title: 'Filter the lead inbox',
  description: 'Reuse the same paginated inbox query as Cowork and BookedSecure. Filter by status, source, text-delivery state or customer search. Returns exact counts and a bounded page; follow next_page for all matches.',
  inputSchema: {
    status: z.enum([...LEAD_STATUSES, 'all']).default('all'), source: z.enum([...SOURCE_CHANNELS, 'all']).default('all'),
    sms: z.enum(SMS_LEAD_FILTERS).default('all'), search: z.string().max(120).default(''), page: z.number().int().min(1).max(100000).default(1),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, source, sms, search, page }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    try {
      const result = await queryLeadInbox(client, { businessId, filters: { status, source, sms, search, scope: 'active' }, page });
      return jsonResult({ leads: result.leads, total: result.page.totalCount, page: result.page.page, next_page: result.page.hasNextPage ? result.page.page + 1 : null });
    } catch { throw new ToolError('The lead inbox could not be read. Please try again.'); }
  },
});