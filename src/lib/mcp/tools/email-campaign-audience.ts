import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'email_campaign_audience', title: 'Count an email audience',
  description: 'Count and sample the customers in a quick email audience: all (everyone with an email), enquiries (open enquiries), quoted (quoted, not booked), booked, past (past customers) or lost. Unsubscribed and opted-out customers are excluded. Use before create_email_campaign with an audience.',
  inputSchema: { audience: z.enum(['all', 'enquiries', 'quoted', 'booked', 'past', 'lost', 'lead_finder']) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ audience }, ctx) => campaignResult(async () => campaignActions.audience(await campaignActor(ctx), { audience })),
});
