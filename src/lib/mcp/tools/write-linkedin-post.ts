import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'write_linkedin_post', title: 'Write a LinkedIn post',
  description: "Write a LinkedIn post for the business from the owner's brief, in BookedSecure's house style. Returns the text only; nothing is posted. Never invent prices, results or customer names.",
  inputSchema: { brief: z.string().max(2000) },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ brief }, ctx) => linkedInResult(async () => { const actor = await linkedInActor(ctx, { action: 'write' }); return linkedInActions.write(actor.businessId, brief); }),
});
