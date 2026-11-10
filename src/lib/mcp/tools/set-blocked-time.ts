import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { blockedTimeInput, executeAvailabilityAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'set_blocked_time', title: 'Block or unblock time',
  description: "Owner only, same action as Cowork. Block time so nothing can be booked (day off, holiday, own appointment) or remove a block. Dates and times are the business's local time: date YYYY-MM-DD, optional until_date, optional from/to HH:MM (none = whole day). To unblock, use an id from business_settings blocked_time. Confirm with the owner first.",
  inputSchema: blockedTimeInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeAvailabilityAction(client, { kind: 'blocked', input })); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});
