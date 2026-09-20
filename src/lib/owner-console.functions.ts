/**
 * Owner control room: request layer. Platform admin only — every call is gated
 * by `requirePlatformAdmin`, so no tenant can ever read another tenant's money.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOwnerConsole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);
    const { readOwnerConsole } = await import("@/lib/owner-console.server");
    const { monthKey } = await import("@/lib/provider-costs.server");
    return await readOwnerConsole(data?.month ?? monthKey());
  });

/**
 * Non-throwing membership check used only to decide where a sign-in lands and
 * whether the control-room link is rendered. It reveals nothing but the
 * caller's own role, so it is safe for every signed-in user to call.
 */
export const getPlatformAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "platform_admin")
      .maybeSingle();
    return { isPlatformAdmin: Boolean(data) };
  });
