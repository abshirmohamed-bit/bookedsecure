import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'prepare_social_message_reply', title: 'Prepare a reply to a Facebook/Instagram DM',
  description: 'Save the wording of a reply to a customer’s Messenger or Instagram DM (platform and participant_id from list_social_conversations). This does NOT send anything: the reply appears in the conversation’s reply box in BookedSecure and the owner taps Send reply. Read social_conversation first; if its reply_window is closed, Meta does not allow a reply, so tell the owner instead. Never say the message was sent. Owner only.',
  inputSchema: {
    platform: z.enum(['facebook', 'instagram']),
    participant_id: z.string().min(1).max(100),
    reply: z.string().trim().min(1).max(1000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, participant_id, reply }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_prepare_social_message_reply', { p_platform: platform, p_participant_id: participant_id, p_reply: reply });
    if (error || !data) throw new ToolError(error?.message ?? 'The reply was not saved.');
    return jsonResult({ saved: true, sent: false, next_step: 'Ask the owner to open BookedSecure → Facebook and Instagram → Messages, check the reply and tap Send reply.' });
  },
});
