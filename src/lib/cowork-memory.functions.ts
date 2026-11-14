import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MEMORY_MAX, SKILL_NAME_MAX, SKILL_STEPS_MAX, SKILL_WHEN_MAX } from "@/lib/cowork-memory";

/** What Co-Work knows about this business: memories and skills (everyone on the team can read). */
export const getCoworkKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { listKnowledge } = await import("@/lib/cowork-memory.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return { ...(await listKnowledge(app.businessId)), canEdit: app.role !== "staff" };
  });

async function ownerApp(context: { supabase: unknown; userId: string }) {
  const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = await requireWriteContext(context.supabase as any, context.userId);
  requireOwner(app);
  return app;
}

/** Adds a memory (no id) or rewrites one. Owners only. */
export const saveCoworkMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid().nullable().optional(),
    kind: z.enum(["fact", "preference"]),
    content: z.string().min(2).max(MEMORY_MAX),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { remember, editMemory } = await import("@/lib/cowork-memory.server");
    if (data.id) {
      await editMemory({ businessId: app.businessId, id: data.id, content: data.content, kind: data.kind });
      return { saved: true };
    }
    const r = await remember({ businessId: app.businessId, userId: app.userId, kind: data.kind, content: data.content, origin: "owner" });
    if (!r.saved) throw new Error(r.message);
    return { saved: true };
  });

export const deleteCoworkMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { deleteMemory } = await import("@/lib/cowork-memory.server");
    await deleteMemory(app.businessId, data.id);
    return { deleted: true };
  });

/** Rewrites a skill (by name; a new name saves a new skill). Owners only. */
export const saveCoworkSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid().nullable().optional(),
    name: z.string().min(2).max(SKILL_NAME_MAX),
    whenToUse: z.string().min(2).max(SKILL_WHEN_MAX),
    steps: z.string().min(2).max(SKILL_STEPS_MAX),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { saveSkill, deleteSkill, listKnowledge } = await import("@/lib/cowork-memory.server");
    // Renaming: the old skill goes once the new one is saved.
    const old = data.id ? (await listKnowledge(app.businessId)).skills.find((s) => s.id === data.id) : null;
    const r = await saveSkill({ businessId: app.businessId, userId: app.userId, name: data.name, whenToUse: data.whenToUse, steps: data.steps, origin: "owner" });
    if (!r.saved) throw new Error(r.message);
    if (old && r.id && r.id !== old.id) await deleteSkill(app.businessId, old.id);
    return { saved: true };
  });

export const deleteCoworkSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await ownerApp(context);
    const { deleteSkill } = await import("@/lib/cowork-memory.server");
    await deleteSkill(app.businessId, data.id);
    return { deleted: true };
  });
