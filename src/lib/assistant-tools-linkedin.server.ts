/**
 * In-app Assistant (Cowork) tools for LinkedIn posting, built on the shared
 * linkedInActions so ChatGPT and Claude behave exactly the same way.
 * Publishing needs the confirmation code from preview_linkedin_post, given only
 * after the owner says yes to that exact post. LinkedIn has no messaging API,
 * so there are no message tools.
 */
import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";
import { LINKEDIN_POST_MAX } from "@/lib/linkedin";
import { linkedInActions } from "@/lib/linkedin.server";

const AUTHOR = z.string().regex(/^urn:li:(person|organization):[\w-]+$/).nullable().default(null)
  .describe("Who to post as, from linkedin_status authors. Null uses the saved default. Never show it to the owner.");
const fail = (message: string) => ({ ok: false as const, message });
const PLATFORM = z.enum(["linkedin", "facebook", "instagram"]).default("linkedin").describe("Where to post: linkedin (default), facebook (the connected Page) or instagram (needs pictures, so Instagram posts are made on the Social media page, not here).");

export function buildLinkedInTools(ctx: AssistantToolContext) {
  const owner = ctx.role !== "staff";
  async function run<T>(label: string | null, work: () => Promise<T>) {
    try {
      const result = await work();
      if (label) ctx.record(label);
      return { ok: true as const, ...(result as object) };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "That didn't work. Nothing was posted.");
    }
  }

  return {
    linkedin_status: tool({
      description: "Which social accounts can be posted to: LinkedIn (profile and Company Pages, and when to renew), the connected Facebook Page and its linked Instagram account. LinkedIn messages can't be read or sent from BookedSecure.",
      inputSchema: z.object({}),
      execute: async () => run(null, () => linkedInActions.status(ctx.businessId)),
    }),

    list_linkedin_posts: tool({
      description: "Recent LinkedIn, Facebook or Instagram posts made from BookedSecure, newest first, with links and any failures.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10), platform: PLATFORM }),
      execute: async ({ limit, platform }) => run(null, async () => ({ posts: await linkedInActions.posts(ctx.businessId, limit, platform) })),
    }),

    write_linkedin_post: tool({
      description: "Write a LinkedIn, Facebook or Instagram post from the owner's brief, in that network's style. Returns the text only; nothing is posted. Never invent prices, results or customer names.",
      inputSchema: z.object({ brief: z.string().max(2000), platform: PLATFORM }),
      execute: async ({ brief, platform }) => run(null, () => linkedInActions.write(ctx.businessId, brief, platform)),
    }),

    preview_linkedin_post: tool({
      description: "Step 1 of posting to LinkedIn or the Facebook Page: returns exactly what will be posted, where and as whom, and a confirmationCode. Show the owner the full post and ask them to confirm. Never post without their clear yes.",
      inputSchema: z.object({ text: z.string().trim().min(1).max(LINKEDIN_POST_MAX), authorUrn: AUTHOR, platform: PLATFORM }),
      execute: async (input) => (owner ? run(null, () => linkedInActions.preview(ctx.businessId, input)) : fail("Only the business owner can post.")),
    }),

    publish_linkedin_post: tool({
      description: "Step 2: publish the post. Only after preview_linkedin_post and the owner's clear yes to that exact post; pass the same platform, text, authorUrn and its confirmationCode. Report the link it returns.",
      inputSchema: z.object({ text: z.string().trim().min(1).max(LINKEDIN_POST_MAX), authorUrn: AUTHOR, confirmationCode: z.string().min(4).max(16), platform: PLATFORM }),
      execute: async (input) => {
        if (!owner) return fail("Only the business owner can post.");
        const result = await run(input.platform === "linkedin" ? "Posted to LinkedIn." : input.platform === "facebook" ? "Posted to Facebook." : "Posted to Instagram.", () => linkedInActions.publish(ctx.businessId, ctx.userId, { ...input, source: "assistant" }));
        if (result.ok) {
          await supabaseAdmin.from("audit_events").insert({ business_id: ctx.businessId, user_id: ctx.userId, event_type: "assistant_linkedin_publish", entity_type: "business", entity_id: ctx.businessId, metadata: {} })
            .then(() => undefined, () => undefined);
        }
        return result;
      },
    }),
  };
}
