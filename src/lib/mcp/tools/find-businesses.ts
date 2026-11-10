import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { leadFinderState, runLeadSearch } from '@/lib/lead-finder.server';
import { leadFinderActor, leadFinderResult } from '../lead-finder-actor';

export default defineTool({
  name: 'find_businesses', title: 'Find businesses (Lead finder)',
  description: "Run a Lead finder search for the owner: find businesses of a type in an Australian area (web search and OpenStreetMap), read their websites, judge whether each one fits, and keep the email address each publishes on its own site. Uses one of the business's 20 monthly searches and takes up to a minute, so only run it when the owner asked to find businesses; for a vague request call suggest_lead_searches first and ask which. Nothing is sent. Results also appear on the Lead finder page.",
  inputSchema: {
    what: z.string().min(3).max(120).describe("The kind of business, e.g. 'warehouses' or 'security companies'."),
    where: z.string().min(2).max(80).describe("An Australian suburb, city or region, e.g. 'Auburn NSW'."),
    criteria: z.string().max(400).optional().describe('Who exactly fits, e.g. 50+ staff on site.'),
    limit: z.number().int().min(1).max(20).default(10),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ what, where, criteria, limit }, ctx) => leadFinderResult(async () => {
    const actor = await leadFinderActor(ctx, 'search', { what, where });
    const r = await runLeadSearch({ businessId: actor.businessId, userId: actor.userId, what, where, criteria: criteria ?? null, limit });
    const state = await leadFinderState(actor.businessId, r.searchId);
    return {
      found: r.found,
      withEmail: r.withEmail,
      results: state.results.map((b) => ({ id: b.id, name: b.name, suburb: b.suburb, fit: b.fit, why: b.fitReason, email: b.email, emailCheck: b.emailStatus, phone: b.phone, website: b.website })),
      nextStep: "Show the good fits. To reach them, call add_found_businesses_to_customers with their ids, then create_email_campaign with audience lead_finder. Sending still needs preview_email_campaign_send and the owner's yes.",
    };
  }),
});
