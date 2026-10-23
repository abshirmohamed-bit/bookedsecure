import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'list_owner_reminders', title: 'Read scheduled owner reminder texts',
  description: 'List recent and upcoming booking-summary texts scheduled for the owner, with their status.',
  inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('owner_sms_reminders').select('id,label,send_at,range_start,range_end,status,parts_sent,failure_reason,sent_at').eq('business_id', businessId).order('send_at', { ascending: false }).limit(limit);
    if (error) throw new ToolError(error.message);
    return jsonResult({ reminders: data ?? [] });
  },
});
