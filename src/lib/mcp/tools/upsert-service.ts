import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { serviceInput, executeSharedAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'upsert_service', title: 'Add or update a service',
  description: 'Reuse Cowork’s service action. Read list_services first when updating; pass only the owner’s stated prices and details, and null for unchanged fields. Requires owner and current access.',
  inputSchema: serviceInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeSharedAction(client, 'upsert_service', input)); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});