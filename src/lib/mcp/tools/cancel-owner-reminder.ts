import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
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
