import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'send_email_reply', title: 'Send an email answer to a customer',
  description: 'Step 2: email the answer to the customer, from the business name, threaded with their reply. Only after preview_email_reply AND the owner said yes to that exact wording in this conversation; pass the same bodyText and its confirmationCode. Their next reply comes back to Campaigns > Replies. Owner only.',
  inputSchema: { recipientId: z.string().uuid().describe('The conversation id (recipientId) from list_email_replies. Never show it in replies.'), bodyText: z.string().trim().min(1).max(10000), confirmationCode: z.string().min(4).max(16) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ recipientId, bodyText, confirmationCode }, ctx) => campaignResult(async () => { const reader = await campaignActor(ctx); const thread = await campaignActions.replyThread(reader, { recipientId }); const actor = await campaignActor(ctx, { action: 'send', campaignId: thread.campaign?.campaignId ?? null, metadata: { kind: 'reply' } }); return campaignActions.sendReply(actor, { recipientId, bodyText, confirmationCode }); }),
});
