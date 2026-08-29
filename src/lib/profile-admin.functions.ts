import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ReassignSchema = z.object({
  profileId: z.string().uuid(),
  businessId: z.string().uuid(),
  active: z.boolean().optional(),
});

/**
 * Trusted reassignment path for `profiles.business_id` / `profiles.active`.
 *
 * The `authenticated` role has no UPDATE privilege on those columns, so tenant
 * reassignment can only happen here: the caller's platform_admin role is
 * verified with their own (RLS-scoped) client first, then the privileged
 * service-role client invokes `admin_set_profile_assignment`, which also writes
 * an audit event. No immutability trigger is used, so service-role/admin
 * administration is never blocked.
 */
export const adminReassignProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReassignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin.rpc("admin_set_profile_assignment", {
      p_profile_id: data.profileId,
      p_business_id: data.businessId,
      ...(data.active === undefined ? {} : { p_active: data.active }),
    });
    if (error) throw new Error(error.message);

    return { ok: true as const, profile: updated };
  });
