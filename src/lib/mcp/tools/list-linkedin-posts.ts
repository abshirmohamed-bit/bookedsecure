import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'list_linkedin_posts', title: 'Recent social posts',
  description: 'Recent LinkedIn, Facebook or Instagram posts made from BookedSecure, newest first, with links and any failures.',
  inputSchema: { limit: z.number().int().min(1).max(50).default(10), platform: z.enum(['linkedin', 'facebook', 'instagram']).default('linkedin').describe('Where to post: linkedin (default), facebook (the connected Page) or instagram (needs pictures, so Instagram posts are made on the Social media page, not here).') },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, platform }, ctx) => linkedInResult(async () => ({ posts: await linkedInActions.posts((await linkedInActor(ctx)).businessId, limit, platform) })),
});
