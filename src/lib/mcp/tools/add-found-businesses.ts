import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { addFoundToCustomers } from '@/lib/lead-finder.server';
import { leadFinderActor, leadFinderResult } from '../lead-finder-actor';

export default defineTool({
  name: 'add_found_businesses_to_customers', title: 'Add found businesses to customers',
  description: "Add chosen Lead finder businesses (ids from find_businesses or lead_finder_results) to the owner's customers as prospects, so an email campaign with audience lead_finder can reach them. Only ones with a usable published email are added. Nothing is sent.",
  inputSchema: { ids: z.array(z.string().uuid()).min(1).max(20) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ ids }, ctx) => leadFinderResult(async () => {
    const actor = await leadFinderActor(ctx, 'add', { count: ids.length });
    const r = await addFoundToCustomers(actor.businessId, actor.userId, ids);
    return { ...r, nextStep: "Create an email campaign with audience lead_finder. Sending still needs preview_email_campaign_send and the owner's clear yes." };
  }),
});
