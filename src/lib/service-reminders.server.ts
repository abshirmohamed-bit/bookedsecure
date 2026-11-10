/**
 * Service reminders, run by the 10-minute follow-ups hook. For each business
 * that turned them on, a customer whose last completed job is one interval old
 * gets one text (sendSms idempotency key per job) with their personal booking
 * link. Skipped when the customer has a newer job or an upcoming booking, has
 * no SMS consent, opted out or is suppressed. sendSms keeps credits and
 * duplicate guards; during quiet hours the run simply waits.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { campaignShortLink } from "@/lib/reactivation";
import {
  SERVICE_REMINDER_GRACE_DAYS,
  SERVICE_REMINDER_RULE_TYPE,
  minutesToDays,
  renderServiceReminder,
  serviceReminderDecision,
  serviceReminderIdempotencyKey,
} from "@/lib/service-reminders";
import { evaluateQuietHoursGate } from "@/lib/sms/quiet-hours";

const MAX_PER_RUN = 50;
const DAY_MS = 86_400_000;

export async function processDueServiceReminders(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const { data: rules } = await supabaseAdmin
    .from("automation_rules")
    .select("business_id, delay_minutes, message_template")
    .eq("rule_type", SERVICE_REMINDER_RULE_TYPE)
    .eq("active", true);
  const origin = (process.env["PUBLIC_APP_URL"]?.trim() || "https://bookedsecure.com").replace(/\/+$/, "");

  for (const rule of rules ?? []) {
    const intervalDays = Math.max(7, minutesToDays(Number(rule.delay_minutes) || 0));
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name, slug, timezone, quiet_hours_start, quiet_hours_end, automation_enabled")
      .eq("id", rule.business_id)
      .maybeSingle();
    if (!business || business.automation_enabled === false) continue;
    const gate = evaluateQuietHoursGate(
      { timezone: business.timezone ?? "Australia/Sydney", quiet_hours_start: business.quiet_hours_start ?? 21, quiet_hours_end: business.quiet_hours_end ?? 8 },
      now,
    );
    if (gate.blocked) continue;

    const newest = new Date(now.getTime() - intervalDays * DAY_MS).toISOString();
    const oldest = new Date(now.getTime() - (intervalDays + SERVICE_REMINDER_GRACE_DAYS) * DAY_MS).toISOString();
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
      if (serviceReminderDecision(job.completed_at, intervalDays, now) !== "due") continue;
      const key = serviceReminderIdempotencyKey(job.id);
      const { data: earlier } = await supabaseAdmin.from("messages").select("id").eq("business_id", rule.business_id).eq("idempotency_key", key).limit(1);
      if (earlier && earlier.length > 0) continue;

      // Only the customer's latest visit counts, and never when they're already booked again.
      const { data: later } = await supabaseAdmin
        .from("jobs")
        .select("id, completion_status, completed_at, scheduled_at")
        .eq("business_id", rule.business_id)
        .eq("lead_id", job.lead_id)
        .neq("id", job.id)
        .neq("completion_status", "cancelled")
        .limit(50);
      const done = Date.parse(job.completed_at ?? "");
      const hasNewer = (later ?? []).some((j) =>
        (j.completion_status === "completed" && Date.parse(j.completed_at ?? "") > done) ||
        (j.completion_status !== "completed" && j.scheduled_at && Date.parse(j.scheduled_at) > done));
      if (hasNewer) { totals.skipped += 1; continue; }

      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("name, consent_status, opted_out_at, sms_suppressed_at, public_token")
        .eq("id", job.lead_id)
        .eq("business_id", rule.business_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!lead || lead.consent_status !== "granted" || lead.opted_out_at || lead.sms_suppressed_at) { totals.skipped += 1; continue; }

      const bookingLink = campaignShortLink(origin, lead.public_token) ?? (business.slug ? `${origin}/quote/${business.slug}` : null);
      const { sendSms } = await import("@/lib/lead-engine.server");
      const result = await sendSms({
        businessId: rule.business_id,
        leadId: job.lead_id,
        body: renderServiceReminder(rule.message_template, { customerName: lead.name, businessName: business.name, intervalDays, bookingLink }),
        kind: "manual",
        respectAutomation: false,
        userId: null,
        source: "automation",
        templateId: "service_reminder.v1",
        idempotencyKey: key,
      });
      if (result.sent) totals.sent += 1;
      else if (!result.duplicate) totals.failed += 1;
    }
  }
  return totals;
}
