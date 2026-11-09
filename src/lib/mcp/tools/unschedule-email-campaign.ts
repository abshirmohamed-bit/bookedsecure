import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'unschedule_email_campaign', title: 'Unschedule an email campaign',
  description: 'Move a scheduled email campaign back to a draft so it does not send. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId }, ctx) => campaignResult(async () => campaignActions.unschedule(await campaignActor(ctx, { action: 'unschedule', campaignId }), { campaignId })),
});
