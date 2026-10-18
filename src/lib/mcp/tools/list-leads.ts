import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'list_leads', title: 'List customers and leads',
  description: 'List existing customers, contacts and leads in the connected business, including names, emails, phone numbers and status. Use offset to retrieve every page; never call a partial page the complete customer list. Optionally filter by name.',
  inputSchema: { name: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).max(100000).default(0) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name, limit, offset }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    let query = client.from('leads').select('id,name,email,mobile_number,notes,status,customer_status,booking_status,created_at', { count: 'exact' }).eq('business_id', businessId).is('deleted_at', null).order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
    if (name) query = query.ilike('name', `%${name.replace(/[%_\\]/g, '\\$&')}%`);
    const { data, error, count } = await query;
    if (error) throw new ToolError(error.message);
    const leads = data ?? [];
    return jsonResult({ leads, total: count, offset, next_offset: count !== null && offset + leads.length < count ? offset + leads.length : null });
  },
});