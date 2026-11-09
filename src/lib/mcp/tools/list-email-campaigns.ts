import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'list_email_campaigns', title: 'List email campaigns and results',
  description: 'List email campaigns, newest first, with status (draft, scheduled, sending, sent, cancelled), recipients, sent, failed, follow-ups and customers who booked within 30 days. Use to report results and to find a campaign to change or send.',
  inputSchema: { limit: z.number().int().min(1).max(20).default(10) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => campaignResult(async () => campaignActions.list(await campaignActor(ctx), { limit })),
});
