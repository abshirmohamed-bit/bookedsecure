import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'preview_email_campaign_send', title: 'Preview before sending',
  description: 'Step 1 of sending or scheduling: returns exactly what will go out (subject, body, number of recipients, first names, follow-up) and a confirmationCode. Show this summary to the owner and ask them to confirm. Never send without their clear yes in this conversation. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.') },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId }, ctx) => campaignResult(async () => campaignActions.previewSend(await campaignActor(ctx, { action: 'preview', campaignId }), { campaignId })),
});
