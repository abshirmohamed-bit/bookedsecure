/**
 * Assistant (Co-work) tools for Lead finder: suggest who to look for from the
 * business's own profile, run a search, read the results, and add chosen
 * businesses to customers. Nothing is ever sent from here: reaching them is
 * an email campaign, which keeps its own preview and the owner's yes.
 */
import { tool } from "ai";
import { z } from "zod";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";

const fail = (message: string) => ({ ok: false as const, message });

export function buildLeadFinderTools(ctx: AssistantToolContext) {
  const { businessId } = ctx;
  const isOwner = ctx.role !== "staff";
  return {
    suggest_lead_searches: tool({
      description:
        "Suggest who this business should look for in Lead finder (businesses to reach with an email campaign), from its own business profile, and the owner's words when they say who they want. Returns 3-4 searches (what, where, criteria, why). Nothing is searched.",
      inputSchema: z.object({ request: z.string().max(500).optional(), likeCustomerId: z.string().uuid().optional().describe("A customer's lead id, to find more businesses like them") }),
      execute: async ({ request, likeCustomerId }) => {
        const { suggestLeadSearches } = await import("@/lib/lead-finder.server");
        try {
          return { ok: true, suggestions: await suggestLeadSearches(businessId, request ?? null, likeCustomerId ?? null) };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't suggest searches.");
        }
      },
    }),

    find_businesses: tool({
      description:
        "Run a Lead finder search: find businesses of a type in an area (web search and OpenStreetMap), read their websites, judge fit against the criteria, and keep the emails they publish. Uses one of the business's 20 monthly searches and can take a minute, so only run it when the owner asked to find businesses (for a vague request, suggest searches first and ask which). Nothing is sent. Results are on the Lead finder page.",
      inputSchema: z.object({
        what: z.string().min(3).max(120),
        where: z.string().min(2).max(80),
        criteria: z.string().max(400).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ what, where, criteria, limit }) => {
        if (!isOwner) return fail("Only the business owner can run Lead finder searches.");
        const { runLeadSearch, leadFinderState } = await import("@/lib/lead-finder.server");
        try {
          const r = await runLeadSearch({ businessId, userId: ctx.userId, what, where, criteria: criteria ?? null, limit });
          const state = await leadFinderState(businessId, r.searchId);
          ctx.record(`Ran a Lead finder search for ${what} in ${where}: ${r.found} found, ${r.withEmail} with an email.`);
          return {
            ok: true, found: r.found, withEmail: r.withEmail,
            results: state.results.slice(0, 20).map((b) => ({ id: b.id, name: b.name, suburb: b.suburb, fit: b.fit, why: b.fitReason, email: b.email, emailCheck: b.emailStatus, website: b.website })),
            nextStep: "Show the good fits. To reach them, add them to customers (add_found_businesses_to_customers), then draft an email campaign for the audience lead_finder.",
          };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "The search didn't work.");
        }
      },
    }),

    lead_finder_results: tool({
      description: "The latest Lead finder search and its businesses (fit, reason, published email and its check, website, whether already added to customers).",
      inputSchema: z.object({}),
      execute: async () => {
        const { leadFinderState } = await import("@/lib/lead-finder.server");
        const state = await leadFinderState(businessId, null);
        if (state.setupMissing) return fail("Lead finder is waiting for a one-time database update.");
        return {
          ok: true,
          searches: state.searches.slice(0, 5).map((s) => ({ what: s.query, where: s.area, found: s.found, status: s.status })),
          results: state.results.map((b) => ({ id: b.id, name: b.name, suburb: b.suburb, fit: b.fit, why: b.fitReason, email: b.email, emailCheck: b.emailStatus, added: b.status === "added" })),
          usedThisMonth: state.usedThisMonth, monthlyLimit: state.monthlyLimit,
        };
      },
    }),

    add_found_businesses_to_customers: tool({
      description: "Add chosen Lead finder businesses (ids from find_businesses or lead_finder_results) to customers so an email campaign can reach them (audience lead_finder). Only ones with a usable email are added. Nothing is sent.",
      inputSchema: z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }),
      execute: async ({ ids }) => {
        if (!isOwner) return fail("Only the business owner can add businesses to customers.");
        const { addFoundToCustomers } = await import("@/lib/lead-finder.server");
        try {
          const r = await addFoundToCustomers(businessId, ctx.userId, ids);
          ctx.record(`Added ${r.added} Lead finder businesses to customers.`);
          return { ok: true, ...r, nextStep: "Draft an email campaign with audience lead_finder; it still needs the owner's preview and yes before sending." };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't add them.");
        }
      },
    }),
  };
}
