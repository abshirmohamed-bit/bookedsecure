import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'social_conversation', title: 'Read a Facebook or Instagram DM thread',
  description: 'Read one Facebook Messenger or Instagram DM conversation (last 50 messages, oldest first), the suggested reply if any, and Meta’s reply window: open (within 24 hours), personal_reply_only (1-7 days, a personal reply from the owner) or closed (over 7 days, Meta does not allow a reply). Use platform and participant_id from list_social_conversations.',
  inputSchema: {
    platform: z.enum(['facebook', 'instagram']),
    participant_id: z.string().min(1).max(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ platform, participant_id }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_social_conversation', { p_platform: platform, p_participant_id: participant_id });
    if (error || !data) throw new ToolError(error?.message ?? 'That conversation could not be read.');
    return jsonResult(data);
  },
});
