/**
 * Co-Work's memory tools (the Hermes learning loop): remember facts and the
 * owner's preferences, forget wrong ones, save how a many-step task was done
 * as a skill and read it back, and search earlier conversations. Everything
 * is scoped to this business. Skills only describe how to use Co-Work's
 * usual tools; texts, campaigns and posts keep their Confirm cards.
 */
import { tool } from "ai";
import { z } from "zod";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";
import { MEMORY_MAX, SKILL_NAME_MAX, SKILL_STEPS_MAX, SKILL_WHEN_MAX } from "@/lib/cowork-memory";

const fail = (message: string) => ({ ok: false as const, message });

export function buildMemoryTools(ctx: AssistantToolContext) {
  const { businessId, userId } = ctx;
  const isOwner = ctx.role !== "staff";
  return {
    remember: tool({
      description:
        "Save a lasting note about this business or how the owner likes things done, so you know it in every future conversation. Use when the owner says 'remember', states a standing rule ('we never do boats', 'always sign texts as Usama', 'Mondays are admin days'), or corrects how you did something in a way that should stick. One short sentence per note. Not for one-off details of a single booking, and never a customer's private details.",
      inputSchema: z.object({
        kind: z.enum(["fact", "preference"]).describe("fact: something true about the business; preference: how the owner wants things done"),
        content: z.string().min(2).max(MEMORY_MAX),
      }),
      execute: async ({ kind, content }) => {
        const { remember } = await import("@/lib/cowork-memory.server");
        try {
          const r = await remember({ businessId, userId, kind, content, origin: "owner" });
          if (r.saved) ctx.record(r.message);
          return r.saved ? { ok: true, message: r.message } : fail(r.message);
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't save that.");
        }
      },
    }),

    forget: tool({
      description: "Remove a saved note when the owner says it's wrong or out of date, or asks you to forget it. Describe the note in a few words; the closest match is removed.",
      inputSchema: z.object({ matching: z.string().min(2).max(MEMORY_MAX) }),
      execute: async ({ matching }) => {
        if (!isOwner) return fail("Only the business owner can remove what Co-Work remembers.");
        const { forget } = await import("@/lib/cowork-memory.server");
        try {
          const r = await forget({ businessId, matching });
          if (r.removed.length) ctx.record(r.message);
          return r.removed.length ? { ok: true, message: r.message } : fail(r.message);
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't remove that.");
        }
      },
    }),

    list_memories: tool({
      description: "Everything you remember about this business and the skills you have saved. Use when the owner asks what you know or remember.",
      inputSchema: z.object({}),
      execute: async () => {
        const { listKnowledge, MEMORY_OFF } = await import("@/lib/cowork-memory.server");
        try {
          const k = await listKnowledge(businessId);
          if (k.setupMissing) return fail(MEMORY_OFF);
          return {
            ok: true,
            facts: k.memories.filter((m) => m.kind === "fact").map((m) => m.content),
            preferences: k.memories.filter((m) => m.kind === "preference").map((m) => m.content),
            skills: k.skills.map((s) => ({ name: s.name, whenToUse: s.whenToUse, uses: s.uses })),
            note: "The owner can edit all of this in What Co-Work knows on the Co-Work page.",
          };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't read what you know.");
        }
      },
    }),

    save_skill: tool({
      description:
        "Save how a task is done as a skill you can follow next time: after a task with several steps worked and is likely to come up again (a weekly recap, a posting routine, how to handle a type of enquiry), offer it, and save when the owner agrees or asks ('do it this way every time'). Steps are plain numbered actions using your usual tools; they never skip a confirmation (texts, campaigns, posts and bookings keep theirs).",
      inputSchema: z.object({
        name: z.string().min(2).max(SKILL_NAME_MAX),
        whenToUse: z.string().min(2).max(SKILL_WHEN_MAX),
        steps: z.string().min(2).max(SKILL_STEPS_MAX).describe("Numbered steps, one per line"),
      }),
      execute: async ({ name, whenToUse, steps }) => {
        const { saveSkill } = await import("@/lib/cowork-memory.server");
        try {
          const r = await saveSkill({ businessId, userId, name, whenToUse, steps, origin: "owner" });
          if (r.saved) ctx.record(r.message);
          return r.saved ? { ok: true, message: r.message } : fail(r.message);
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't save that skill.");
        }
      },
    }),

    use_skill: tool({
      description: "Read the steps of a saved skill (listed in your instructions) before doing a task it covers, then follow them with your usual tools and confirmations, adjusting to what the owner asked this time.",
      inputSchema: z.object({ name: z.string().min(2).max(SKILL_NAME_MAX) }),
      execute: async ({ name }) => {
        const { readSkill } = await import("@/lib/cowork-memory.server");
        try {
          const s = await readSkill(businessId, name);
          return s ? { ok: true, name: s.name, whenToUse: s.whenToUse, steps: s.steps } : fail("No saved skill by that name.");
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't read that skill.");
        }
      },
    }),

    search_past_chats: tool({
      description: "Search this business's earlier Co-Work conversations for what was said or decided ('what did we decide about the spring campaign?', 'when did I last ask about Brandon?'). Returns the best matching moment from each conversation with its date.",
      inputSchema: z.object({ query: z.string().min(2).max(200) }),
      execute: async ({ query }) => {
        const { searchPastChats } = await import("@/lib/cowork-memory.server");
        try {
          const hits = await searchPastChats(businessId, query);
          return hits.length
            ? { ok: true, results: hits.map((h) => ({ conversation: h.title, date: h.at.slice(0, 10), said: h.snippet })) }
            : { ok: true, results: [], message: "Nothing in earlier conversations matches that." };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't search earlier conversations.");
        }
      },
    }),
  };
}
