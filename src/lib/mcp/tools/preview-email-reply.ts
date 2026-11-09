import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'preview_email_reply', title: 'Preview an email answer to a customer',
  description: "Step 1 of answering a customer's email reply: returns exactly what will be emailed (to, subject, body) and a confirmationCode. Write the answer in the owner's words, show it to the owner and ask them to confirm. Never send without their clear yes. Owner only.",
  inputSchema: { recipientId: z.string().uuid().describe('The conversation id (recipientId) from list_email_replies. Never show it in replies.'), bodyText: z.string().trim().min(1).max(10000) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipientId, bodyText }, ctx) => campaignResult(async () => { const reader = await campaignActor(ctx); const preview = await campaignActions.previewReply(reader, { recipientId, bodyText }); await campaignActor(ctx, { action: 'preview', campaignId: preview.campaignId, metadata: { kind: 'reply' } }); return preview; }),
});
