import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'business_snapshot', title: 'Read business totals',
  description: 'Read exact counts for existing non-deleted customers/leads, upcoming bookings, completed jobs and email campaigns. These are record counts, not unique people or revenue estimates.',
  inputSchema: {}, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const now = new Date().toISOString();
    const [leads, upcoming, completed, campaigns] = await Promise.all([
      client.from('leads').select('id', { count: 'exact', head: true }).eq('business_id', businessId).is('deleted_at', null),
      client.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('completion_status', 'scheduled').gte('scheduled_at', now),
      client.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('completion_status', 'completed'),
      client.from('email_campaigns').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    ]);
    if ([leads, upcoming, completed, campaigns].some(result => result.error || result.count === null)) throw new ToolError('Business totals could not be read.');
    return jsonResult({ as_of: now, customer_lead_records: leads.count, upcoming_bookings: upcoming.count, completed_jobs: completed.count, email_campaigns: campaigns.count });
  },
});