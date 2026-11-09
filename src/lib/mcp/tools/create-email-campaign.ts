import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'create_email_campaign', title: 'Create an email campaign draft',
  description: 'Create an email campaign draft for an audience (all, enquiries, quoted, booked, past, lost) or named customers (leadIds from list_leads or query_leads; never pick recipients from a partial page). Optional followUp goes to customers who have not booked after delayDays. replyTo sets where replies go. It appears on the Campaigns page. Nothing is emailed until send_email_campaign. Owner only.',
  inputSchema: { name: z.string().min(2).max(120), subject: z.string().min(2).max(160), bodyText: z.string().min(2).max(5000), audience: z.enum(['all', 'enquiries', 'quoted', 'booked', 'past', 'lost']).optional(), leadIds: z.array(z.string().uuid()).min(1).max(500).optional(), followUp: z.object({ subject: z.string().min(2).max(160), bodyText: z.string().min(2).max(5000), delayDays: z.number().int().min(1).max(30), stopOnBooking: z.boolean().default(true) }).optional(), replyTo: z.string().email().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => campaignResult(async () => campaignActions.create(await campaignActor(ctx, { action: 'draft', metadata: { name: input.name } }), input)),
});
