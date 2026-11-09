import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'email_reply_thread', title: 'Read an email reply conversation',
  description: 'Read one email conversation with a customer: the campaign they replied to and every message (customer and business), oldest first. Marks their replies as read.',
  inputSchema: { recipientId: z.string().uuid().describe('The conversation id (recipientId) from list_email_replies. Never show it in replies.') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipientId }, ctx) => campaignResult(async () => campaignActions.replyThread(await campaignActor(ctx), { recipientId })),
});
