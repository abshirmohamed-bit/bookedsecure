import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Platform-admin only, read-only Telnyx activation readiness report.
 * Performs GET lookups and returns pass/fail checks; it never sends a message,
 * provisions a number, or changes sender, tenant or billing state.
 */
export const telnyxReadinessCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    const { runTelnyxReadinessCheck } = await import("@/lib/telnyx-readiness.server");
    return runTelnyxReadinessCheck();
  });
