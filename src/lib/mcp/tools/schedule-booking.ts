import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'schedule_booking', title: 'Schedule or move a booking',
  description: 'Schedule or move an owner-entered booking for a looked-up lead at the user’s explicitly requested time; saves the job and lead together and rejects occupied slots.',
  inputSchema: { lead_id: z.string().uuid(), scheduled_at: z.string().datetime({ offset: true }) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id, scheduled_at }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_schedule_job', { p_lead_id: lead_id, p_scheduled_at: scheduled_at });
    if (error || !data) throw new ToolError(error?.code === '23505' ? 'That time is already booked. Nothing was saved.' : error?.message ?? 'Nothing was saved.');
    return jsonResult({ saved: true, job_id: data });
  },
});