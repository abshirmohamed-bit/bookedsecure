import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { availabilityInput, executeAvailabilityAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'update_availability', title: 'Update bookable availability',
  description: 'Owner only, same action as Co-Work. Change when customers can book: online booking on/off, weekly working hours (replaces the list; weekday 0 = Sunday), earliest booking, days ahead, travel time between jobs, how often start times are offered, and the customer reminder (hours before; 0 = off). Read business_settings first; null leaves a setting unchanged. Show the owner what will change and get their explicit yes first.',
  inputSchema: availabilityInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeAvailabilityAction(client, { kind: 'update', input })); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});
