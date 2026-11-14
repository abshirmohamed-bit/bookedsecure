/**
 * Co-Work's routine tools (the Hermes scheduler): set up something Co-Work
 * does on a schedule, list, change, pause, remove or run one soon. Routines
 * only read and prepare; their drafts and Confirm cards wait in the routine's
 * own conversation for the owner's yes. The YouTube channel watch is switched
 * on in Co-Work's Routines panel, where the owner confirms the rights.
 */
import { tool } from "ai";
import { z } from "zod";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";
import { ROUTINE_FREQS, ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX } from "@/lib/cowork-routines";

const fail = (message: string) => ({ ok: false as const, message });

const scheduleInput = z.object({
  freq: z.enum(ROUTINE_FREQS).describe("daily, weekdays (Mon-Fri), weekly or monthly"),
  at: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).describe("Local time, 24-hour HH:MM"),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional().describe("weekly: 1=Monday .. 7=Sunday"),
  dayOfMonth: z.number().int().min(1).max(31).optional().describe("monthly: day of the month"),
});

export function buildRoutineTools(ctx: AssistantToolContext) {
  const { businessId, userId } = ctx;
  const isOwner = ctx.role !== "staff";
  const ownerOnly = () => fail("Only the business owner can set up or change routines.");
  return {
    create_routine: tool({
      description:
        "Set up something Co-Work does on a schedule, in the business's own time: 'every Monday at 8 send me last week's numbers', 'each weekday at 7am tell me today's bookings', 'on the 1st draft a LinkedIn post about last month'. Write `prompt` as the instruction Co-Work will follow each time. Routines read and prepare drafts and Confirm cards only; they never send, post, book or change anything themselves. The report appears in the bell and its own Co-Work conversation (and by email if asked). Confirm the schedule back in plain words.",
      inputSchema: z.object({
        name: z.string().min(2).max(ROUTINE_NAME_MAX),
        prompt: z.string().min(4).max(ROUTINE_PROMPT_MAX),
        schedule: scheduleInput,
        deliverByEmail: z.boolean().optional().describe("Also email the report to the owner"),
      }),
      execute: async ({ name, prompt, schedule, deliverByEmail }) => {
        if (!isOwner) return ownerOnly();
        const { createRoutine } = await import("@/lib/cowork-routines.server");
        try {
          const r = await createRoutine({ businessId, userId, name, prompt, schedule, deliverEmail: deliverByEmail ?? false });
          ctx.record(`Set up the routine "${r.name}" (${r.when}).`);
          return { ok: true, name: r.name, when: r.when, firstRun: r.nextRunAt };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't set that routine up.");
        }
      },
    }),

    list_routines: tool({
      description: "The routines Co-Work runs for this business, with when each runs next, its last result and whether the YouTube channel watch is on.",
      inputSchema: z.object({}),
      execute: async () => {
        const { listRoutines, ROUTINES_OFF } = await import("@/lib/cowork-routines.server");
        try {
          const r = await listRoutines(businessId);
          if (r.setupMissing) return fail(ROUTINES_OFF);
          return {
            ok: true,
            routines: r.routines.map((x) => ({
              id: x.id, name: x.name, when: x.when, on: x.enabled, nextRun: x.nextRunAt, lastRun: x.lastRunAt,
              lastResult: x.lastResult ? x.lastResult.slice(0, 400) : null, emailed: x.deliverEmail, kind: x.kind === "watch_channel" ? "YouTube channel watch" : "routine",
            })),
            note: "The owner can also see and change these in Routines on the Co-Work page.",
          };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't read routines.");
        }
      },
    }),

    update_routine: tool({
      description: "Change a routine the owner names: its instruction, schedule or email, or pause and resume it. Use list_routines first to find it.",
      inputSchema: z.object({
        routineId: z.string().uuid(),
        name: z.string().min(2).max(ROUTINE_NAME_MAX).optional(),
        prompt: z.string().min(4).max(ROUTINE_PROMPT_MAX).optional(),
        schedule: scheduleInput.optional(),
        deliverByEmail: z.boolean().optional(),
        on: z.boolean().optional().describe("false pauses, true resumes"),
      }),
      execute: async ({ routineId, name, prompt, schedule, deliverByEmail, on }) => {
        if (!isOwner) return ownerOnly();
        const { updateRoutine } = await import("@/lib/cowork-routines.server");
        try {
          const r = await updateRoutine({ businessId, id: routineId, name, prompt, schedule, deliverEmail: deliverByEmail, enabled: on });
          ctx.record(`Updated the routine "${r.name}" (${r.enabled ? r.when : "paused"}).`);
          return { ok: true, name: r.name, when: r.when, on: r.enabled, nextRun: r.nextRunAt };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't change that routine.");
        }
      },
    }),

    delete_routine: tool({
      description: "Remove a routine, only when the owner clearly asks to delete or stop it for good (pausing is update_routine with on false).",
      inputSchema: z.object({ routineId: z.string().uuid() }),
      execute: async ({ routineId }) => {
        if (!isOwner) return ownerOnly();
        const { deleteRoutine } = await import("@/lib/cowork-routines.server");
        try {
          await deleteRoutine(businessId, routineId);
          ctx.record("Removed the routine.");
          return { ok: true };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't remove that routine.");
        }
      },
    }),

    run_routine_now: tool({
      description: "Run a routine soon instead of waiting for its time (it starts within about 10 minutes; the report arrives in the bell and its conversation).",
      inputSchema: z.object({ routineId: z.string().uuid() }),
      execute: async ({ routineId }) => {
        if (!isOwner) return ownerOnly();
        const { runRoutineSoon } = await import("@/lib/cowork-routines.server");
        try {
          await runRoutineSoon(businessId, routineId);
          ctx.record("Started the routine; its report arrives within about 10 minutes.");
          return { ok: true, message: "It runs within about 10 minutes." };
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Couldn't start that routine.");
        }
      },
    }),
  };
}
