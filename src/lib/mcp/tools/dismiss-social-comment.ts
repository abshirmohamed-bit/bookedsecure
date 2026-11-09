import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'dismiss_social_comment', title: 'Dismiss a Facebook/Instagram comment',
  description: 'Mark a customer comment as not needing a reply (comment_id from list_social_comments). It moves to Dismissed in BookedSecure; nothing is posted, hidden or deleted on Facebook or Instagram, and the owner can move it back to review. Only for comments the owner asked to dismiss. Owner only.',
  inputSchema: { comment_id: z.string().uuid() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ comment_id }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_dismiss_social_comment', { p_comment_id: comment_id });
    if (error || !data) throw new ToolError(error?.message ?? 'The comment was not changed.');
    return jsonResult({ saved: true, status: 'dismissed' });
  },
});
