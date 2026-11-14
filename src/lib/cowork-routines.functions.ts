import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX, routineScheduleSchema } from "@/lib/cowork-routines";

/** Every routine for this business (the team can read). */
export const getCoworkRoutines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { listRoutines } = await import("@/lib/cowork-routines.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return { ...(await listRoutines(app.businessId)), canEdit: app.role !== "staff" };
  });

async function ownerApp(context: { supabase: unknown; userId: string }) {
  const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = await requireWriteContext(context.supabase as any, context.userId);
  requireOwner(app);
  return app;
}

export const createCoworkRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    name: z.string().min(2).max(ROUTINE_NAME_MAX),
    prompt: z.string().min(4).max(ROUTINE_PROMPT_MAX),
    schedule: routineScheduleSchema,
    deliverEmail: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { createRoutine } = await import("@/lib/cowork-routines.server");
    return createRoutine({ businessId: app.businessId, userId: app.userId, name: data.name, prompt: data.prompt, schedule: data.schedule, deliverEmail: data.deliverEmail ?? false });
  });

export const updateCoworkRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    enabled: z.boolean().optional(),
    deliverEmail: z.boolean().optional(),
    runNow: z.boolean().optional(),
    remove: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const server = await import("@/lib/cowork-routines.server");
    if (data.remove) { await server.deleteRoutine(app.businessId, data.id); return { ok: true }; }
    if (data.runNow) { await server.runRoutineSoon(app.businessId, data.id); return { ok: true }; }
    await server.updateRoutine({ businessId: app.businessId, id: data.id, enabled: data.enabled, deliverEmail: data.deliverEmail });
    return { ok: true };
  });

/** Switches the YouTube channel watch on (with the owner's rights confirmation) or off. */
export const setCoworkChannelWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    enabled: z.boolean(),
    rightsConfirmed: z.literal(true).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { setChannelWatch } = await import("@/lib/cowork-routines.server");
    await setChannelWatch({ businessId: app.businessId, userId: app.userId, enabled: data.enabled, rightsConfirmed: data.rightsConfirmed === true });
    return { ok: true };
  });
