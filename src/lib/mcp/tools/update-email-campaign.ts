import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'update_email_campaign', title: 'Change an email campaign draft',
  description: 'Change a draft or scheduled email campaign: name, subject, body, replyTo, the follow-up (followUp) or removeFollowUp, add or remove customers (addLeadIds/removeLeadIds), or replace all recipients with an audience (replaceWithAudience). After any change, preview again before sending. Owner only.',
  inputSchema: { campaignId: z.string().uuid().describe('From list_email_campaigns or create_email_campaign. Never show it in replies.'), name: z.string().min(2).max(120).optional(), subject: z.string().min(2).max(160).optional(), bodyText: z.string().min(2).max(5000).optional(), replyTo: z.string().email().optional(), followUp: z.object({ subject: z.string().min(2).max(160), bodyText: z.string().min(2).max(5000), delayDays: z.number().int().min(1).max(30), stopOnBooking: z.boolean().default(true) }).optional(), removeFollowUp: z.boolean().optional(), addLeadIds: z.array(z.string().uuid()).max(500).optional(), removeLeadIds: z.array(z.string().uuid()).max(500).optional(), replaceWithAudience: z.enum(['all', 'enquiries', 'quoted', 'booked', 'past', 'lost']).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => campaignResult(async () => campaignActions.update(await campaignActor(ctx, { action: 'update', campaignId: input.campaignId }), input)),
});
