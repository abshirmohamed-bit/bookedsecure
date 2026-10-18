import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'list_leads', title: 'Find your leads',
  description: 'Find active leads in your business by name, returning IDs, contact details, notes and current status.',
  inputSchema: { name: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).default(25) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name, limit }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    let query = client.from('leads').select('id,name,email,mobile_number,notes,status,booking_status,created_at').eq('business_id', businessId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit);
    if (name) query = query.ilike('name', `%${name.replace(/[%_\\]/g, '\\$&')}%`);
    const { data, error } = await query;
    if (error) throw new ToolError(error.message);
    return jsonResult({ leads: data ?? [] });
  },
});