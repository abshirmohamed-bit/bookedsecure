/**
 * Review requests: pure rules. After a job is marked done, one text asks the
 * customer for a review, using the owner's own words and link. Stored as an
 * automation_rules row (rule_type "review_request"), off until the owner turns
 * it on. Tenant-neutral: no business, link or wording is hardcoded.
 */
import { firstName } from "@/lib/domain";

export const REVIEW_RULE_TYPE = "review_request";
/** Jobs finished longer ago than this are never asked (no surprise texts weeks later). */
export const REVIEW_MAX_AGE_HOURS = 72;
export const REVIEW_DELAY_CHOICES = [60, 180, 1440, 2880] as const;

export function defaultReviewTemplate(): string {
  return "Hi {{first_name}}, thanks for choosing {{business_name}}! If you're happy with the job, a quick review would mean a lot: {{review_link}}";
}

/** True when the message has a web link (or the {{review_link}} placeholder plus a saved link). */
export function reviewTemplateProblem(template: string, reviewLink: string | null): string | null {
  const text = template.trim();
  if (text.length < 10) return "Write the message customers will get.";
  if (text.length > 480) return "Keep the message under 480 characters.";
  const hasLink = /https?:\/\/\S+/i.test(text) || (/\{\{review_link\}\}/.test(text) && Boolean(reviewLink));
  if (!hasLink) return "Add your review link so customers can leave a review.";
  return null;
}

export function renderReviewRequest(template: string, values: { customerName: string | null; businessName: string; reviewLink: string | null }): string {
  return template
    .replace(/\{\{\s*first_name\s*\}\}/g, firstName(values.customerName?.trim() || "there"))
    .replace(/\{\{\s*business_name\s*\}\}/g, values.businessName)
    .replace(/\{\{\s*review_link\s*\}\}/g, values.reviewLink ?? "")
    .replace(/\s+$/g, "")
    .trim();
}

/** Due once the delay after completion has passed, and only within REVIEW_MAX_AGE_HOURS. */
export function reviewDecision(completedAt: string | null, delayMinutes: number, now: Date): "due" | "not_yet" | "too_old" | "not_completed" {
  if (!completedAt) return "not_completed";
  const done = Date.parse(completedAt);
  if (Number.isNaN(done)) return "not_completed";
  const dueAt = done + Math.max(0, delayMinutes) * 60_000;
  if (now.getTime() < dueAt) return "not_yet";
  if (now.getTime() - done > REVIEW_MAX_AGE_HOURS * 60 * 60_000 + Math.max(0, delayMinutes) * 60_000) return "too_old";
  return "due";
}

export function reviewRequestIdempotencyKey(jobId: string): string {
  return `review_request:${jobId}`;
}

/** Pulls the saved review link out of the owner's message, for showing it back in the form. */
export function reviewLinkIn(template: string): string | null {
  return template.match(/https?:\/\/\S+/i)?.[0]?.replace(/[).,!]+$/, "") ?? null;
}
