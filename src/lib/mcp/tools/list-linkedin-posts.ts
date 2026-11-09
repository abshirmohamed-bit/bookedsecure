import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'list_linkedin_posts', title: 'Recent LinkedIn posts',
  description: 'Recent LinkedIn posts made from BookedSecure, newest first, with links and any failures.',
  inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => linkedInResult(async () => ({ posts: await linkedInActions.posts((await linkedInActor(ctx)).businessId, limit) })),
});
