/**
 * Customer appointment reminders, run by the 10-minute follow-ups hook.
 *
 * Only for businesses that set customer_reminder_hours (Business and services →
 * Bookable availability). Each booking is claimed (customer_reminder_sent_at)
 * before its text is sent, so overlapping runs can't text twice, and the job is
 * re-read at claim time, so a cancelled or moved booking is never reminded.
 * Sends go through sendSms, which keeps opt-out, suppression, quiet hours,
 * credits and idempotency. Quiet hours: the run waits until they end.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CUSTOMER_REMINDER_TEMPLATE_ID,
  customerReminderIdempotencyKey,
  reminderDecision,
  renderCustomerReminder,
} from "@/lib/customer-reminder";
import { evaluateQuietHoursGate } from "@/lib/sms/quiet-hours";

const MAX_PER_RUN = 100;

export async function processDueCustomerReminders(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const { data: settings, error } = await supabaseAdmin
    .from("booking_availability")
    .select("business_id, customer_reminder_hours" as never)
    .not("customer_reminder_hours" as never, "is", null);
  // Column not there yet (docs/booking-api.sql not applied): nothing to do.
  if (error || !settings) return totals;

  for (const row of settings as unknown as Array<{ business_id: string; customer_reminder_hours: number }>) {
    const hours = Number(row.customer_reminder_hours);
    if (!Number.isInteger(hours) || hours <= 0) continue;

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name, timezone, quiet_hours_start, quiet_hours_end")
      .eq("id", row.business_id)
      .maybeSingle();
    if (!business) continue;
    const timezone = business.timezone ?? "Australia/Sydney";
    const gate = evaluateQuietHoursGate(
      { timezone, quiet_hours_start: business.quiet_hours_start ?? 21, quiet_hours_end: business.quiet_hours_end ?? 8 },
      now,
    );
    if (gate.blocked) continue;

    const windowEnd = new Date(now.getTime() + hours * 60 * 60_000).toISOString();
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, lead_id, scheduled_at, created_at, completion_status, service_id, service_performed, customer_reminder_sent_at" as never)
      .eq("business_id", row.business_id)
      .eq("completion_status", "scheduled")
      .is("customer_reminder_sent_at" as never, null)
      .gt("scheduled_at", now.toISOString())
      .lte("scheduled_at", windowEnd)
      .order("scheduled_at", { ascending: true })
      .limit(MAX_PER_RUN);

    for (const job of (jobs ?? []) as unknown as Array<{
      id: string;
      lead_id: string;
      scheduled_at: string;
      created_at: string;
      completion_status: string;
      service_performed: string | null;
    }>) {
      const decision = reminderDecision(job, hours, now);
      if (decision === "not_yet") continue;

      // Claim first: only one run can move the marker from null.
      const { data: claimed } = await supabaseAdmin
        .from("jobs")
        .update({ customer_reminder_sent_at: now.toISOString() } as never)
        .eq("id", job.id)
        .eq("business_id", row.business_id)
        .eq("completion_status", "scheduled")
        .eq("scheduled_at", job.scheduled_at)
        .is("customer_reminder_sent_at" as never, null)
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      if (decision !== "due") {
        totals.skipped += 1;
        await audit(row.business_id, job.id, job.lead_id, decision);
        continue;
      }

      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("name, consent_status, service_name_snapshot")
        .eq("id", job.lead_id)
        .eq("business_id", row.business_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!lead || lead.consent_status !== "granted") {
        totals.skipped += 1;
        await audit(row.business_id, job.id, job.lead_id, lead ? "skip_no_consent" : "skip_no_customer");
        continue;
      }

      const { sendSms } = await import("@/lib/lead-engine.server");
      const result = await sendSms({
        businessId: row.business_id,
        leadId: job.lead_id,
        body: renderCustomerReminder({
          customerName: lead.name,
          businessName: business.name,
          serviceName: job.service_performed ?? lead.service_name_snapshot,
          startsAt: job.scheduled_at,
          timezone,
        }),
        kind: "manual",
        respectAutomation: false,
        userId: null,
        source: "automation",
        templateId: CUSTOMER_REMINDER_TEMPLATE_ID,
        idempotencyKey: customerReminderIdempotencyKey(job.id),
      });
      if (result.sent || result.duplicate) {
        totals.sent += result.sent ? 1 : 0;
        await audit(row.business_id, job.id, job.lead_id, result.sent ? "sent" : "duplicate_suppressed");
      } else if (result.code === "quiet_hours_blocked") {
        // Not sent: release the claim so the next run after quiet hours sends it.
        await supabaseAdmin
          .from("jobs")
          .update({ customer_reminder_sent_at: null } as never)
          .eq("id", job.id)
          .eq("business_id", row.business_id);
      } else {
        totals.failed += 1;
        await audit(row.business_id, job.id, job.lead_id, "failed", result.reason ?? null);
      }
    }
  }
  return totals;
}

async function audit(businessId: string, jobId: string, leadId: string, outcome: string, reason: string | null = null) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: businessId,
    event_type: "customer_reminder_sms",
    entity_type: "job",
    entity_id: jobId,
    metadata: { lead_id: leadId, outcome, reason, template_id: CUSTOMER_REMINDER_TEMPLATE_ID } as never,
  });
}
