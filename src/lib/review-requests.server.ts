/**
 * Review requests, run by the 10-minute follow-ups hook. For each business that
 * turned them on, every job marked done is asked once (sendSms idempotency key
 * per job), after the owner's delay, only within three days of completion and
 * only to customers with SMS consent. sendSms keeps opt-out, suppression,
 * credits and quiet hours; during quiet hours the run simply waits.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  REVIEW_MAX_AGE_HOURS,
  REVIEW_RULE_TYPE,
  renderReviewRequest,
  reviewDecision,
  reviewRequestIdempotencyKey,
} from "@/lib/review-requests";
import { evaluateQuietHoursGate } from "@/lib/sms/quiet-hours";

const MAX_PER_RUN = 50;

export async function processDueReviewRequests(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const { data: rules } = await supabaseAdmin
    .from("automation_rules")
    .select("business_id, delay_minutes, message_template")
    .eq("rule_type", REVIEW_RULE_TYPE)
    .eq("active", true);

  for (const rule of rules ?? []) {
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name, timezone, quiet_hours_start, quiet_hours_end, automation_enabled")
      .eq("id", rule.business_id)
      .maybeSingle();
    if (!business || business.automation_enabled === false) continue;
    const gate = evaluateQuietHoursGate(
      { timezone: business.timezone ?? "Australia/Sydney", quiet_hours_start: business.quiet_hours_start ?? 21, quiet_hours_end: business.quiet_hours_end ?? 8 },
      now,
    );
    if (gate.blocked) continue;

    const delay = Math.max(0, Number(rule.delay_minutes) || 0);
    const newest = new Date(now.getTime() - delay * 60_000).toISOString();
    const oldest = new Date(now.getTime() - delay * 60_000 - REVIEW_MAX_AGE_HOURS * 60 * 60_000).toISOString();
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, lead_id, completed_at")
      .eq("business_id", rule.business_id)
      .eq("completion_status", "completed")
      .gte("completed_at", oldest)
      .lte("completed_at", newest)
      .order("completed_at", { ascending: true })
      .limit(MAX_PER_RUN);

    for (const job of jobs ?? []) {
      if (reviewDecision(job.completed_at, delay, now) !== "due") continue;
      const key = reviewRequestIdempotencyKey(job.id);
      // Already asked for this job (sendSms also guards this key).
      const { data: earlier } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("business_id", rule.business_id)
        .eq("idempotency_key", key)
        .limit(1);
      if (earlier && earlier.length > 0) continue;

      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("name, consent_status, opted_out_at, sms_suppressed_at")
        .eq("id", job.lead_id)
        .eq("business_id", rule.business_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!lead || lead.consent_status !== "granted" || lead.opted_out_at || lead.sms_suppressed_at) {
        totals.skipped += 1;
        continue;
      }

      const { sendSms } = await import("@/lib/lead-engine.server");
      const result = await sendSms({
        businessId: rule.business_id,
        leadId: job.lead_id,
        body: renderReviewRequest(rule.message_template, { customerName: lead.name, businessName: business.name, reviewLink: null }),
        kind: "manual",
        respectAutomation: false,
        userId: null,
        source: "automation",
        templateId: "review_request.v1",
        idempotencyKey: key,
      });
      if (result.sent) totals.sent += 1;
      else if (!result.duplicate) totals.failed += 1;
    }
  }
  return totals;
}
