/**
 * Automatic job completion: for businesses that switch it on, a booked job
 * counts as done once its time has passed, unless the owner cancelled it.
 * Pure helpers; the database work is in job-autocomplete.server.ts.
 */

/** How long a job is assumed to take when its service doesn't say. */
export const DEFAULT_JOB_MINUTES = 120;

/** When a job is finished: its start plus the service length (or the default). */
export function jobEndsAt(scheduledAt: string, durationMinutes: number | null | undefined): Date {
  const minutes = Number.isFinite(durationMinutes) && Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_JOB_MINUTES;
  return new Date(Date.parse(scheduledAt) + minutes * 60_000);
}

/**
 * The job's value from the business's own price for the service: the first
 * dollar amount written ("From $280" → 280, "$1,200" → 1200). Ranges use the
 * lower figure; "Price on enquiry" gives null, so nothing is invented.
 */
export function jobValueFromPrice(priceGuidance: string | null | undefined): number | null {
  const match = (priceGuidance ?? "").match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** True when a scheduled job should now be marked done. */
export function isDueForAutoComplete(job: { completion_status: string | null; scheduled_at: string | null }, durationMinutes: number | null | undefined, now = new Date()): boolean {
  if (job.completion_status !== "scheduled" || !job.scheduled_at) return false;
  return jobEndsAt(job.scheduled_at, durationMinutes).getTime() <= now.getTime();
}
