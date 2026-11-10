import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The owner's review request (Automations page). Stored as one automation_rules row. */
export const getReviewRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("./app-context.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { REVIEW_RULE_TYPE, defaultReviewTemplate, reviewLinkIn } = await import("./review-requests");
    const { data } = await supabaseAdmin
      .from("automation_rules")
      .select("id, active, delay_minutes, message_template")
      .eq("business_id", ctx.businessId)
      .eq("rule_type", REVIEW_RULE_TYPE)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const template = data?.message_template ?? defaultReviewTemplate();
    return {
      isOwner: ctx.role !== "staff",
      active: Boolean(data?.active),
      delayMinutes: data?.delay_minutes ?? 180,
      template,
      reviewLink: reviewLinkIn(template),
    };
  });

export const saveReviewRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      active: z.boolean(),
      delayMinutes: z.number().int().min(0).max(10080),
      template: z.string().trim().min(10).max(480),
      reviewLink: z.string().trim().url().max(300).nullable(),
    }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("./app-context.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    requireOwner(ctx);
    const { REVIEW_RULE_TYPE, reviewTemplateProblem } = await import("./review-requests");
    // The link is written into the message itself, so what's saved is exactly what's sent.
    const template = data.reviewLink ? data.template.replace(/\{\{\s*review_link\s*\}\}/g, data.reviewLink) : data.template;
    const problem = reviewTemplateProblem(template, null);
    if (data.active && problem) throw new Error(problem);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("automation_rules")
      .select("id")
      .eq("business_id", ctx.businessId)
      .eq("rule_type", REVIEW_RULE_TYPE)
      .limit(1)
      .maybeSingle();
    const row = { active: data.active, delay_minutes: data.delayMinutes, message_template: template };
    const { error } = existing
      ? await supabaseAdmin.from("automation_rules").update(row).eq("id", existing.id).eq("business_id", ctx.businessId)
      : await supabaseAdmin.from("automation_rules").insert({ ...row, business_id: ctx.businessId, rule_type: REVIEW_RULE_TYPE, step: 1 });
    if (error) throw new Error("Could not save the review request.");
    await supabaseAdmin.from("audit_events").insert({
      business_id: ctx.businessId, user_id: ctx.userId, event_type: "review_request_updated", entity_type: "business",
      entity_id: ctx.businessId, metadata: { active: data.active, delay_minutes: data.delayMinutes },
    });
    return { ok: true };
  });
