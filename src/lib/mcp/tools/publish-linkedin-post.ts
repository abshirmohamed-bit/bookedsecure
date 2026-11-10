import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'publish_linkedin_post', title: 'Publish a social post',
  description: 'Step 2: publish the post publicly on LinkedIn or the Facebook Page. Only after preview_linkedin_post AND the owner said yes to that exact post in this conversation; pass the same platform, text, authorUrn and its confirmationCode. Report the link it returns. Owner only.',
  inputSchema: { text: z.string().trim().min(1).max(3000), authorUrn: z.string().regex(/^urn:li:(person|organization):[\w-]+$/).nullable().default(null).describe('Who to post as, from linkedin_status authors; null uses the saved default. Never show it.'), confirmationCode: z.string().min(4).max(16), platform: z.enum(['linkedin', 'facebook', 'instagram']).default('linkedin').describe('Where to post: linkedin (default), facebook (the connected Page) or instagram (needs pictures, so Instagram posts are made on the Social media page, not here).') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ text, authorUrn, confirmationCode, platform }, ctx) => linkedInResult(async () => { const actor = await linkedInActor(ctx, { action: 'publish', metadata: { platform } }); return linkedInActions.publish(actor.businessId, actor.userId, { text, authorUrn, confirmationCode, source: 'mcp', platform }); }),
});
