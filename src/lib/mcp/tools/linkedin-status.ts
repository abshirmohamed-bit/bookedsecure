import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { linkedInActions } from '@/lib/linkedin.server';
import { linkedInActor, linkedInResult } from '../linkedin-actor';

export default defineTool({
  name: 'linkedin_status', title: 'LinkedIn connection',
  description: 'Whether the business has connected LinkedIn in BookedSecure, who it can post as (personal profile and Company Pages) and when the connection must be renewed. LinkedIn messages cannot be read or sent through BookedSecure.',
  inputSchema: {  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => linkedInResult(async () => linkedInActions.status((await linkedInActor(ctx)).businessId)),
});
