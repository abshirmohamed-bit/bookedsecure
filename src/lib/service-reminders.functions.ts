import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The owner's service reminder (Automations page). Stored as one automation_rules row. */
export const getServiceReminder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("./app-context.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SERVICE_REMINDER_RULE_TYPE, defaultServiceIntervalDays, defaultServiceReminderTemplate, minutesToDays } = await import("./service-reminders");
    const { readSavedProfile } = await import("./business-profile");
    const [{ data }, { data: business }, { data: profileRow }] = await Promise.all([
      supabaseAdmin.from("automation_rules").select("active, delay_minutes, message_template")
        .eq("business_id", ctx.businessId).eq("rule_type", SERVICE_REMINDER_RULE_TYPE).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      supabaseAdmin.from("businesses").select("trade").eq("id", ctx.businessId).maybeSingle(),
      supabaseAdmin.from("businesses").select("business_profile").eq("id", ctx.businessId).maybeSingle().then((r) => r, () => ({ data: null })),
    ]);
    const profile = readSavedProfile((profileRow as { business_profile?: unknown } | null)?.business_profile);
    return {
      isOwner: ctx.role !== "staff",
      active: Boolean(data?.active),
      intervalDays: data ? minutesToDays(data.delay_minutes) : defaultServiceIntervalDays(business?.trade ?? null, profile?.enquiryFlow?.rebookDays ?? null),
      template: data?.message_template ?? defaultServiceReminderTemplate(),
    };
  });

export const saveServiceReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ active: z.boolean(), intervalDays: z.number().int().min(7).max(730), template: z.string().trim().min(10).max(480) }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("./app-context.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    requireOwner(ctx);
    const { SERVICE_REMINDER_RULE_TYPE, daysToMinutes, serviceReminderTemplateProblem } = await import("./service-reminders");
    const problem = serviceReminderTemplateProblem(data.template);
    if (data.active && problem) throw new Error(problem);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("automation_rules").select("id")
      .eq("business_id", ctx.businessId).eq("rule_type", SERVICE_REMINDER_RULE_TYPE).limit(1).maybeSingle();
    const row = { active: data.active, delay_minutes: daysToMinutes(data.intervalDays), message_template: data.template };
    const { error } = existing
      ? await supabaseAdmin.from("automation_rules").update(row).eq("id", existing.id).eq("business_id", ctx.businessId)
      : await supabaseAdmin.from("automation_rules").insert({ ...row, business_id: ctx.businessId, rule_type: SERVICE_REMINDER_RULE_TYPE, step: 1 });
    if (error) throw new Error("Could not save the service reminder.");
    await supabaseAdmin.from("audit_events").insert({
      business_id: ctx.businessId, user_id: ctx.userId, event_type: "service_reminder_updated", entity_type: "business",
      entity_id: ctx.businessId, metadata: { active: data.active, interval_days: data.intervalDays },
    });
    return { ok: true };
  });
