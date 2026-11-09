import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'publish_linkedin_post', title: 'Publish a LinkedIn post',
  description: 'Step 2: publish the post publicly on LinkedIn. Only after preview_linkedin_post AND the owner said yes to that exact post in this conversation; pass the same text, authorUrn and its confirmationCode. Report the link it returns. Owner only.',
  inputSchema: { text: z.string().trim().min(1).max(3000), authorUrn: z.string().regex(/^urn:li:(person|organization):[\w-]+$/).nullable().default(null).describe('Who to post as, from linkedin_status authors; null uses the saved default. Never show it.'), confirmationCode: z.string().min(4).max(16) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ text, authorUrn, confirmationCode }, ctx) => linkedInResult(async () => { const actor = await linkedInActor(ctx, { action: 'publish' }); return linkedInActions.publish(actor.businessId, actor.userId, { text, authorUrn, confirmationCode, source: 'mcp' }); }),
});
