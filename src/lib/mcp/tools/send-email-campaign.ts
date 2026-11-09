import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'send_email_campaign', title: 'Send an email campaign now',
  description: 'Step 2: send the campaign to its customers now. Only after preview_email_campaign_send AND the owner explicitly said yes to that summary in this conversation. Pass its confirmationCode; if the campaign changed, preview again. Emails go out under the business name from campaigns@bookedsecure.com. Report the sent and failed counts this returns. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.'), confirmationCode: z.string().min(4).max(16) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ campaignId, confirmationCode }, ctx) => campaignResult(async () => campaignActions.send(await campaignActor(ctx, { action: 'send', campaignId }), { campaignId, confirmationCode })),
});
