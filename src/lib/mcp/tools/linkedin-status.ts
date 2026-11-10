import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'linkedin_status', title: 'Social accounts',
  description: 'Which social accounts the business can post to from BookedSecure: LinkedIn (personal profile and Company Pages, and when to renew), the connected Facebook Page and its linked Instagram account. LinkedIn messages cannot be read or sent through BookedSecure.',
  inputSchema: {  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => linkedInResult(async () => linkedInActions.status((await linkedInActor(ctx)).businessId)),
});
