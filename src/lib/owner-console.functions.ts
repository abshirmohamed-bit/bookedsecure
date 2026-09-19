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
