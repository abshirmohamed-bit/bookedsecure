import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'preview_linkedin_post', title: 'Preview a LinkedIn post',
  description: 'Step 1 of posting to LinkedIn: returns exactly what will be posted, who it posts as, and a confirmationCode. Show the owner the full post and who it posts as, and ask them to confirm. Never publish without their clear yes. Owner only.',
  inputSchema: { text: z.string().trim().min(1).max(3000), authorUrn: z.string().regex(/^urn:li:(person|organization):[\w-]+$/).nullable().default(null).describe('Who to post as, from linkedin_status authors; null uses the saved default. Never show it.') },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ text, authorUrn }, ctx) => linkedInResult(async () => { const actor = await linkedInActor(ctx, { action: 'preview' }); return linkedInActions.preview(actor.businessId, { text, authorUrn }); }),
});
