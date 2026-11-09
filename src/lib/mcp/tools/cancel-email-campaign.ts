import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'cancel_email_campaign', title: 'Cancel an email campaign',
  description: 'Cancel a draft or scheduled email campaign so it is never sent. Only when the owner asks. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.') },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId }, ctx) => campaignResult(async () => campaignActions.cancel(await campaignActor(ctx, { action: 'cancel', campaignId }), { campaignId })),
});
