import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'list_bookings', title: 'Read your bookings',
  description: 'Read scheduled bookings in your business within a specified time range; results are not an availability guarantee.',
  inputSchema: { from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), limit: z.number().int().min(1).max(100).default(50) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, limit }, ctx) => {
    if (Date.parse(to) <= Date.parse(from)) throw new ToolError('End time must be after start time.');
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('jobs').select('id,lead_id,scheduled_at,completion_status').eq('business_id', businessId).eq('completion_status', 'scheduled').gte('scheduled_at', from).lte('scheduled_at', to).order('scheduled_at').limit(limit);
    if (error) throw new ToolError(error.message);
    return jsonResult({ bookings: data ?? [] });
  },
});