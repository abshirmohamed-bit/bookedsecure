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
      description: "Whether LinkedIn is connected, who the business can post as (profile and Company Pages) and when the connection must be renewed. LinkedIn messages can't be read or sent from BookedSecure.",
      inputSchema: z.object({}),
      execute: async () => run(null, () => linkedInActions.status(ctx.businessId)),
    }),

    list_linkedin_posts: tool({
      description: "Recent LinkedIn posts made from BookedSecure, newest first, with links and any failures.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      execute: async ({ limit }) => run(null, async () => ({ posts: await linkedInActions.posts(ctx.businessId, limit) })),
    }),

    write_linkedin_post: tool({
      description: "Write a LinkedIn post from the owner's brief. Returns the text only; nothing is posted. Never invent prices, results or customer names.",
      inputSchema: z.object({ brief: z.string().max(2000) }),
      execute: async ({ brief }) => run(null, () => linkedInActions.write(ctx.businessId, brief)),
    }),

    preview_linkedin_post: tool({
      description: "Step 1 of posting to LinkedIn: returns exactly what will be posted, who it posts as, and a confirmationCode. Show the owner the full post and ask them to confirm. Never post without their clear yes.",
      inputSchema: z.object({ text: z.string().trim().min(1).max(LINKEDIN_POST_MAX), authorUrn: AUTHOR }),
      execute: async (input) => (owner ? run(null, () => linkedInActions.preview(ctx.businessId, input)) : fail("Only the business owner can post to LinkedIn.")),
    }),

    publish_linkedin_post: tool({
      description: "Step 2: publish the post to LinkedIn. Only after preview_linkedin_post and the owner's clear yes to that exact post; pass the same text, authorUrn and its confirmationCode. Report the link it returns.",
      inputSchema: z.object({ text: z.string().trim().min(1).max(LINKEDIN_POST_MAX), authorUrn: AUTHOR, confirmationCode: z.string().min(4).max(16) }),
      execute: async (input) => {
        if (!owner) return fail("Only the business owner can post to LinkedIn.");
        const result = await run("Posted to LinkedIn.", () => linkedInActions.publish(ctx.businessId, ctx.userId, { ...input, source: "assistant" }));
        if (result.ok) {
          await supabaseAdmin.from("audit_events").insert({ business_id: ctx.businessId, user_id: ctx.userId, event_type: "assistant_linkedin_publish", entity_type: "business", entity_id: ctx.businessId, metadata: {} })
            .then(() => undefined, () => undefined);
        }
        return result;
      },
    }),
  };
}
