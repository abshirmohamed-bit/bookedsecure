import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { campaignActions } from '@/lib/email-campaign-actions.server';
import { campaignActor, campaignResult } from '../campaign-actor';

export default defineTool({
  name: 'write_campaign_email', title: 'Write campaign email wording',
  description: "Have BookedSecure write a campaign email (kind first) or its follow-up (kind follow_up, pass the first email) from the owner's brief. Returns subject and body only; nothing is saved. Never invent prices or offers the owner did not give. Owner only.",
  inputSchema: { kind: z.enum(['first', 'follow_up']), instructions: z.string().max(2000), style: z.array(z.enum(['Keep it short', 'Mention our offer', 'Ask for a reply', 'Casual tone', 'Professional tone', 'No discounts'])).max(6).default([]), firstEmail: z.object({ subject: z.string().max(160), bodyText: z.string().max(5000) }).optional() },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => campaignResult(async () => campaignActions.write(await campaignActor(ctx, { action: 'write' }), input)),
});
