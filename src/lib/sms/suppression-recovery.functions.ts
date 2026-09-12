import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ResumeSchema = z.object({
  leadId: z.string().uuid(),
  confirm: z.literal(true),
});

/**
 * Owner-only: clears the SMS automation pause for one lead after explicit
 * confirmation. Sends nothing and runs no automation.
 */
export const resumeSuppressedSmsAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResumeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner, assertLeadOwnership } = await import(
      "@/lib/app-context.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resumeSuppressedAutomation } = await import("@/lib/sms/suppression-recovery.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    await assertLeadOwnership(app.businessId, data.leadId);
    return resumeSuppressedAutomation(supabaseAdmin, {
      businessId: app.businessId,
      actorUserId: app.userId,
      leadId: data.leadId,
    });
  });
