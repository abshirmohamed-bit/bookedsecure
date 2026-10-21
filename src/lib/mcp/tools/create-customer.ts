import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { customerInput, executeSharedAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'create_customer', title: 'Add a customer',
  description: 'Reuse Cowork’s customer creation action for the connected owner. Only add a customer explicitly requested by the user; never infer text consent.',
  inputSchema: customerInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeSharedAction(client, 'create_customer', input)); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});