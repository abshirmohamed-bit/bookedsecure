/**
 * Customer appointment reminder: pure rules. One text per booking, sent the set
 * number of hours before it starts, only for businesses that switch it on.
 */
import { formatConfirmationDateTime } from "@/lib/booking-confirmation";
import { firstName } from "@/lib/domain";

export const CUSTOMER_REMINDER_TEMPLATE_ID = "customer_reminder.v1" as const;

export type ReminderJob = {
  scheduled_at: string | null;
  created_at: string;
  completion_status: string;
};

/**
 * Due when the booking is still on and starts within the reminder window. A
 * booking made inside the window already got its confirmation moments ago, so
 * it is skipped rather than texted twice.
 */
export function reminderDecision(
  job: ReminderJob,
  reminderHours: number,
  now: Date,
): "due" | "not_yet" | "skip_booked_late" | "skip_past" | "skip_not_scheduled" {
  if (job.completion_status !== "scheduled" || !job.scheduled_at) return "skip_not_scheduled";
  const start = Date.parse(job.scheduled_at);
  if (start <= now.getTime()) return "skip_past";
  const windowOpens = start - reminderHours * 60 * 60_000;
  if (now.getTime() < windowOpens) return "not_yet";
  if (Date.parse(job.created_at) >= windowOpens) return "skip_booked_late";
  return "due";
}

export function renderCustomerReminder(input: {
  customerName: string | null;
  businessName: string;
  serviceName: string | null;
  startsAt: string;
  timezone: string;
}): string {
  const { date, time } = formatConfirmationDateTime(input.startsAt, input.timezone);
  const service = (input.serviceName ?? "").trim() || "booking";
  return `Hi ${firstName(input.customerName?.trim() || "there")}, a reminder that your ${service} with ${input.businessName} is on ${date} at ${time}. Reply here if you need to change it. Reply STOP to opt out.`;
}

export function customerReminderIdempotencyKey(jobId: string): string {
  return `customer_reminder:${jobId}`;
}
