import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'list_email_replies', title: 'List customer replies to email campaigns',
  description: "List conversations where customers replied to the business's campaign emails (Campaigns > Replies in BookedSecure), newest first, with the latest message and unread count. unreadOnly shows only new replies.",
  inputSchema: { unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => campaignResult(async () => campaignActions.replies(await campaignActor(ctx), input)),
});
