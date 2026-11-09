import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'stop_email_campaign_follow_ups', title: 'Stop email follow-ups',
  description: 'Stop every follow-up email of a sent campaign that has not gone out yet. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.') },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaignId }, ctx) => campaignResult(async () => campaignActions.stopFollowUps(await campaignActor(ctx, { action: 'stop_follow_ups', campaignId }), { campaignId })),
});
