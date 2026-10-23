import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'update_lead_notes', title: 'Update lead notes',
  description: 'Replace notes on a previously looked-up active lead; owner access and an active trial or subscription are required.',
  inputSchema: { lead_id: z.string().uuid(), notes: z.string().max(5000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id, notes }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_update_lead_notes', { p_lead_id: lead_id, p_notes: notes });
    if (error || !data) throw new ToolError(error?.message ?? 'Nothing was saved.');
    return jsonResult({ saved: true, lead_id: data });
  },
});