import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'campaign_reports', title: 'Read campaign reports',
  description: 'Read email and SMS reactivation campaigns, their draft/approval state and send dates. This tool does not draft, approve or send campaigns.',
  inputSchema: { offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(25) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ offset, limit }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const [email, sms] = await Promise.all([
      client.from('email_campaigns').select('id,name,subject,status,created_at,approved_at,sent_at', { count: 'exact' }).eq('business_id', businessId).order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1),
      client.from('reactivation_campaigns').select('id,offer_text,status,created_at,approved_at', { count: 'exact' }).eq('business_id', businessId).order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1),
    ]);
    if (email.error || sms.error) throw new ToolError('Campaign reports could not be read.');
    return jsonResult({ email_campaigns: email.data ?? [], sms_campaigns: sms.data ?? [], email_total: email.count, sms_total: sms.count, offset, next_offset: Math.max(email.count ?? 0, sms.count ?? 0) > offset + limit ? offset + limit : null });
  },
});