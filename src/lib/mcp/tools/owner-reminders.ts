import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export const listOwnerReminders = defineTool({
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

export const cancelOwnerReminder = defineTool({
  name: 'cancel_owner_reminder', title: 'Cancel a scheduled owner reminder text',
  description: 'Cancel a pending owner reminder text found with list_owner_reminders.',
  inputSchema: { reminderId: z.string().uuid() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ reminderId }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('cancel_owner_sms_reminder', { p_reminder_id: reminderId });
    if (error || !data) throw new ToolError(error?.message ?? 'The reminder could not be cancelled.');
    return jsonResult({ result: data });
  },
});
