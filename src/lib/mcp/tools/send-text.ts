import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
import { prepareAssistantText, textInput } from '@/lib/assistant-shared-actions';
export default defineTool({
  name: 'send_text', title: 'Prepare a customer reply for approval',
  description: 'Reuse Cowork’s text proposal. Find the customer and read customer_history first, then prepare the user-approved wording. Saves the exact reply to BookedSecure’s ongoing Cowork conversation, where the owner must press Confirm. Does NOT send a text. Existing consent, quiet hours, credits and sending safeguards apply when confirmed.',
  inputSchema: textInput.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    try {
      const proposal = await prepareAssistantText(client, businessId, input);
      const { data, error } = await client.rpc('mcp_prepare_assistant_text', { p_lead_id: proposal.leadId, p_message: proposal.message });
      if (error || !data) throw new Error(error?.message ?? 'The reply could not be saved for approval.');
      return jsonResult({ result: data, next_step: 'Open Home in BookedSecure, review the reply in the ongoing Cowork conversation, and press Confirm. No text has been sent.' });
    } catch (error) { throw new ToolError(error instanceof Error ? error.message : 'The reply could not be prepared.'); }
  },
});