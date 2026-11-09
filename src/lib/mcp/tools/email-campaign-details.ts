import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'email_campaign_details', title: 'Read an email campaign',
  description: "Read one email campaign: wording, follow-up, each recipient's send and follow-up status, and results.",
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.') },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId }, ctx) => campaignResult(async () => campaignActions.details(await campaignActor(ctx), { campaignId })),
});
