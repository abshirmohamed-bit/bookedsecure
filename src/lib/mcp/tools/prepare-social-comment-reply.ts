import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'prepare_social_comment_reply', title: 'Prepare a reply to a Facebook/Instagram comment',
  description: 'Save the wording of a public reply to a customer comment (comment_id from list_social_comments). This does NOT post anything: the reply appears in BookedSecure under Facebook and Instagram, and the owner reviews it and taps Approve & post. Never say the reply was posted. Keep replies short and friendly; never state prices, discounts or availability publicly unless the owner gave them, and never ask for personal details in public. Owner only.',
  inputSchema: { comment_id: z.string().uuid(), reply: z.string().trim().min(1).max(2000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ comment_id, reply }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_prepare_social_comment_reply', { p_comment_id: comment_id, p_reply: reply });
    if (error || !data) throw new ToolError(error?.message ?? 'The reply was not saved.');
    return jsonResult({ saved: true, posted: false, next_step: 'Ask the owner to open BookedSecure → Facebook and Instagram → Comments, check the reply and tap Approve & post.' });
  },
});
