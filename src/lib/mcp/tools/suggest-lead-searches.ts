import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { suggestLeadSearches } from '@/lib/lead-finder.server';
import { leadFinderActor, leadFinderResult } from '../lead-finder-actor';

export default defineTool({
  name: 'suggest_lead_searches', title: 'Suggest who to find',
  description: "Suggest Lead finder searches: which kinds of businesses this business should reach and where, from its own business profile, the owner's words when they say who they want, or an existing customer to find more like (likeCustomerId, a lead id from list_leads). Returns 3-4 searches (what, where, criteria, why). Nothing is searched or sent.",
  inputSchema: {
    request: z.string().max(500).optional().describe("The owner's own words about who they want to reach, e.g. 'warehouses near Auburn with 50+ staff'."),
    likeCustomerId: z.string().uuid().optional().describe('A customer lead id to find more businesses like them.'),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  handler: async ({ request, likeCustomerId }, ctx) => leadFinderResult(async () => {
    const actor = await leadFinderActor(ctx, 'suggest');
    return { suggestions: await suggestLeadSearches(actor.businessId, request ?? null, likeCustomerId ?? null) };
  }),
});
