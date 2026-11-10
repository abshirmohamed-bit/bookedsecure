/**
 * Service reminders: pure rules. Some time after a customer's last completed
 * job (a car service, a pool clean, a detail), one text invites them back with
 * their booking link. Stored as an automation_rules row (rule_type
 * "service_reminder"); delay_minutes holds the interval. Off until the owner
 * turns it on. Tenant-neutral: the interval starts from the business's trade or
 * industry and the owner can change it.
 */
import { firstName } from "@/lib/domain";
import { industryNicheFor } from "@/lib/niche";
import { resolveTrade } from "@/lib/trades";

export const SERVICE_REMINDER_RULE_TYPE = "service_reminder";
const DAY_MIN = 24 * 60;
export const SERVICE_INTERVAL_CHOICES = [28, 42, 56, 90, 180, 365] as const;
/** A reminder is only sent within this many days after it falls due (no surprise texts months late). */
export const SERVICE_REMINDER_GRACE_DAYS = 14;

export const daysToMinutes = (days: number) => Math.round(days * DAY_MIN);
export const minutesToDays = (minutes: number) => Math.round(minutes / DAY_MIN);

export function intervalLabel(days: number): string {
  if (days % 365 === 0) return days === 365 ? "12 months" : `${days / 365} years`;
  if (days >= 84 && days % 30 <= 2) return `${Math.round(days / 30)} months`;
  if (days % 7 === 0) return `${days / 7} weeks`;
  return `${days} days`;
}

/** A sensible starting interval: the trade's usual cycle, about 6 months for workshops, else 3 months. */
export function defaultServiceIntervalDays(trade: string | null | undefined, industry: string | null | undefined): number {
  const preset = resolveTrade(trade);
  if (preset && preset.id !== "other") return preset.reserviceDays.max;
  if (industryNicheFor(industry) === "workshop") return 180;
  return 90;
}

export function defaultServiceReminderTemplate(): string {
  return "Hi {{first_name}}, it's been about {{interval}} since your last visit with {{business_name}}. Due for your next one? Book here: {{booking_link}}";
}

export function serviceReminderTemplateProblem(template: string): string | null {
  const text = template.trim();
  if (text.length < 10) return "Write the message customers will get.";
  if (text.length > 480) return "Keep the message under 480 characters.";
  if (!/\{\{\s*booking_link\s*\}\}|https?:\/\/\S+/i.test(text)) return "Add {{booking_link}} so customers can book straight away.";
  return null;
}

export function renderServiceReminder(template: string, values: { customerName: string | null; businessName: string; intervalDays: number; bookingLink: string | null }): string {
  return template
    .replace(/\{\{\s*first_name\s*\}\}/g, firstName(values.customerName?.trim() || "there"))
    .replace(/\{\{\s*business_name\s*\}\}/g, values.businessName)
    .replace(/\{\{\s*interval\s*\}\}/g, intervalLabel(values.intervalDays))
    .replace(/\s*\{\{\s*booking_link\s*\}\}/g, values.bookingLink ? ` ${values.bookingLink}` : "")
    .replace(/[:,]\s*$/, ".")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Due once the interval after the last completed job has passed, within the grace period. */
export function serviceReminderDecision(lastCompletedAt: string | null, intervalDays: number, now: Date): "due" | "not_yet" | "too_old" | "none" {
  if (!lastCompletedAt) return "none";
  const done = Date.parse(lastCompletedAt);
  if (Number.isNaN(done)) return "none";
  const dueAt = done + intervalDays * DAY_MIN * 60_000;
  if (now.getTime() < dueAt) return "not_yet";
  if (now.getTime() > dueAt + SERVICE_REMINDER_GRACE_DAYS * DAY_MIN * 60_000) return "too_old";
  return "due";
}

export const serviceReminderIdempotencyKey = (jobId: string) => `service_reminder:${jobId}`;
