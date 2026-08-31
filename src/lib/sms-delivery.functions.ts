import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Tenant-scoped SMS delivery summary. Read-only. */
export const getSmsDeliverySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { summariseDelivery } = await import("@/lib/sms/delivery");
    const app = await requireAppContext(context.supabase, context.userId);

    const [messages, suppressed] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("delivery_status, failure_class, message_source")
        .eq("business_id", app.businessId)
        .eq("direction", "outbound")
        .then((response) => response.data ?? []),
      supabaseAdmin
        .from("leads")
        .select("id")
        .eq("business_id", app.businessId)
        .is("deleted_at", null)
        .not("sms_suppressed_at", "is", null)
        .then((response) => response.data ?? []),
    ]);

    return { ...summariseDelivery(messages), suppressedLeads: suppressed.length };
  });

/**
 * Read-only reconciliation against the provider. Owner-only. Never resends,
 * never creates a message, never triggers automation.
 */
export const reconcileSmsDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);

    const { reconcileDeliveryStatuses } = await import("@/lib/sms/reconcile.server");
    return reconcileDeliveryStatuses({
      businessId: app.businessId,
      messageId: data.messageId ?? null,
    });
  });
