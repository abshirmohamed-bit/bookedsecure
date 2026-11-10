import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'write_linkedin_post', title: 'Write a social post',
  description: "Write a LinkedIn, Facebook or Instagram post for the business from the owner's brief, in that network's style. Returns the text only; nothing is posted. Never invent prices, results or customer names.",
  inputSchema: { brief: z.string().max(2000), platform: z.enum(['linkedin', 'facebook', 'instagram']).default('linkedin').describe('Where to post: linkedin (default), facebook (the connected Page) or instagram (needs pictures, so Instagram posts are made on the Social media page, not here).') },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ brief, platform }, ctx) => linkedInResult(async () => { const actor = await linkedInActor(ctx, { action: 'write' }); return linkedInActions.write(actor.businessId, brief, platform); }),
});
