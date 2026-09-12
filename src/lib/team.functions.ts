import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AccessSchema = z.object({ profileId: z.string().uuid(), active: z.boolean() });
const DeleteSchema = z.object({ profileId: z.string().uuid() });

export const setTeamAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { setTeamMemberAccess } = await import("@/lib/team.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const result = await setTeamMemberAccess(
      { businessId: app.businessId, userId: app.userId, role: app.role, via: "settings" },
      data.profileId,
      data.active,
    );
    if (!result.ok) throw new Error(result.error);
    return result;
  });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { deleteTeamMember } = await import("@/lib/team.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const result = await deleteTeamMember(
      { businessId: app.businessId, userId: app.userId, role: app.role, via: "settings" },
      data.profileId,
    );
    if (!result.ok) throw new Error(result.error);
    return result;
  });
