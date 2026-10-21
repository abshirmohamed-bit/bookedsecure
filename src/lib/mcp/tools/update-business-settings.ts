import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { settingsInput, executeSharedAction } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'update_business_settings', title: 'Update business details',
  description: 'Reuse Cowork’s owner-only business settings action: service area, opening hours, contact details, signature, timezone or quiet hours. Read business_settings first; null leaves fields unchanged. Cannot change billing or credentials.',
  inputSchema: settingsInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client } = await callerContext(ctx);
    try { return jsonResult(await executeSharedAction(client, 'update_business_settings', input)); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
  },
});