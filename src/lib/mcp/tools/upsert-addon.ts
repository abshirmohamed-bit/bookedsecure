import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { addonInput, executeSharedAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'upsert_addon', title: 'Add or update an extra',
  description: 'Reuse Cowork’s add-on action. Read list_services first when updating; use the owner’s exact prices. Linking extras to services remains a separate approval in BookedSecure.',
  inputSchema: addonInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeSharedAction(client, 'upsert_addon', input)); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});