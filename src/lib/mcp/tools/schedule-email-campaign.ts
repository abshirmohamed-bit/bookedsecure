import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'schedule_email_campaign', title: 'Schedule an email campaign',
  description: "Step 2 (alternative): schedule the campaign for later instead of sending now. Only after preview_email_campaign_send and the owner's explicit yes; pass its confirmationCode. sendAt is an ISO date-time with the business timezone offset (business_settings has the timezone), 5 minutes to 60 days ahead. Owner only.",
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.'), confirmationCode: z.string().min(4).max(16), sendAt: z.string().datetime({ offset: true }) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId, confirmationCode, sendAt }, ctx) => campaignResult(async () => campaignActions.schedule(await campaignActor(ctx, { action: 'schedule', campaignId, metadata: { sendAt } }), { campaignId, confirmationCode, sendAt })),
});
