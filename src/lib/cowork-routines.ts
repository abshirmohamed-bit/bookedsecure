/**
 * Co-Work routines as plain rules (no database here): when a routine runs
 * next, how its schedule reads to an owner, and which tools a routine may use
 * while the owner isn't watching.
 *
 * A routine reads and prepares: figures, summaries, drafts, Confirm cards.
 * It never books, changes settings, deletes, sends or posts on its own; those
 * stay with the owner's yes, exactly as in a live conversation.
 */
import { z } from "zod";
import { zonedWallTimeToIso } from "@/lib/assistant-time";

export const ROUTINE_FREQS = ["daily", "weekdays", "weekly", "monthly"] as const;
export type RoutineFreq = (typeof ROUTINE_FREQS)[number];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const routineScheduleSchema = z.object({
  freq: z.enum(ROUTINE_FREQS),
  /** Local time, 24-hour "HH:MM". */
  at: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  /** weekly: 1 = Monday .. 7 = Sunday (one or more). */
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  /** monthly: the day of the month (29-31 fall on the month's last day). */
  dayOfMonth: z.number().int().min(1).max(31).optional(),
});
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;

export const MAX_ROUTINES = 20;
export const ROUTINE_NAME_MAX = 80;
export const ROUTINE_PROMPT_MAX = 1200;
/** How often a channel watch looks for new uploads. */
export const WATCH_EVERY_MS = 60 * 60_000;
/** A channel watch clips at most this many new uploads per check. */
export const WATCH_PER_CHECK = 2;
/** Uploads shorter than this aren't clipped (they are already shorts). */
export const WATCH_MIN_SECONDS = 120;

/**
 * Tools a routine may use: reading figures and records, and preparing drafts
 * or Confirm cards. Everything else (booking, settings, deleting, sending,
 * posting, imports, paid searches, clipping) needs the owner in the room.
 */
export const ROUTINE_TOOLS: ReadonlySet<string> = new Set([
  // reading
  "business_profile", "business_snapshot", "campaign_report", "customer_history", "email_campaign_audience",
  "email_campaign_details", "email_reply_thread", "facebook_ad_performance", "facebook_lead_import_status",
  "find_customers", "google_ad_performance", "lead_finder_results", "linkedin_status", "list_bookings",
  "list_email_campaigns", "list_email_replies", "list_linkedin_posts", "list_memories", "list_services",
  "list_social_comments", "list_social_conversations", "list_upcoming_bookings", "notifications_summary",
  "performance_metrics", "query_leads", "quote_funnel", "read_settings", "read_social_conversation",
  "search_past_chats", "suggest_lead_searches", "today_overview", "unfinished_prospects", "use_skill",
  "video_clip_plan", "video_clip_settings", "video_clip_styles", "video_clips_status", "video_engine_catalog",
  "video_engine_status", "video_style_recipes", "youtube_channel_insights", "youtube_comments", "youtube_title_ideas",
  // preparing (drafts and Confirm cards; nothing goes out)
  "write_campaign_email", "write_linkedin_post", "prepare_social_reply", "draft_email_campaign",
  "send_text", "draft_campaign", "preview_linkedin_post", "preview_email_campaign_send", "preview_email_reply",
]);

/** Only the tools a routine may use, from Co-Work's full set. */
export function routineTools<T extends Record<string, unknown>>(all: T): Partial<T> {
  return Object.fromEntries(Object.entries(all).filter(([name]) => ROUTINE_TOOLS.has(name))) as Partial<T>;
}

const pad = (n: number) => String(n).padStart(2, "0");

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

function lastDayOfMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts; // en-CA gives YYYY-MM-DD
}

/** Whether a routine runs on this local date. */
export function runsOn(schedule: RoutineSchedule, date: string): boolean {
  const wd = weekdayOf(date);
  switch (schedule.freq) {
    case "daily": return true;
    case "weekdays": return wd <= 5;
    case "weekly": return (schedule.weekdays?.length ? schedule.weekdays : [1]).includes(wd);
    case "monthly": {
      const want = schedule.dayOfMonth ?? 1;
      const day = Number(date.slice(8, 10));
      return day === Math.min(want, lastDayOfMonth(date));
    }
  }
}

/** The next time a routine runs after `after`, as an ISO timestamp (null when the schedule never fires). */
export function nextRunAt(schedule: RoutineSchedule, timeZone: string, after: Date = new Date()): string | null {
  const parsed = routineScheduleSchema.safeParse(schedule);
  if (!parsed.success) return null;
  const s = parsed.data;
  const [h, m] = s.at.split(":").map(Number);
  const at = `${pad(h!)}:${pad(m!)}`;
  let date = localDate(new Date(after.getTime() - 86_400_000), timeZone);
  for (let i = 0; i < 70; i++, date = addDays(date, 1)) {
    if (!runsOn(s, date)) continue;
    const iso = zonedWallTimeToIso(date, at, timeZone);
    if (iso && Date.parse(iso) > after.getTime()) return iso;
  }
  return null;
}

/** How a schedule reads to an owner: "Every Monday at 8:00 am". */
export function describeSchedule(schedule: RoutineSchedule): string {
  const [h, m] = schedule.at.split(":").map(Number);
  const time = `${((h! + 11) % 12) + 1}:${pad(m!)} ${h! < 12 ? "am" : "pm"}`;
  switch (schedule.freq) {
    case "daily": return `Every day at ${time}`;
    case "weekdays": return `Every weekday at ${time}`;
    case "weekly": {
      const days = (schedule.weekdays?.length ? [...schedule.weekdays].sort() : [1]).map((d) => WEEKDAY_NAMES[d - 1]);
      const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
      return `Every ${list} at ${time}`;
    }
    case "monthly": {
      const d = schedule.dayOfMonth ?? 1;
      const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
      return `Every month on the ${d}${suffix} at ${time}`;
    }
  }
}

/** What Co-Work is told when a routine runs (the owner's words are the task; nobody is watching). */
export function routineRequest(name: string, prompt: string): string {
  return [
    `[Scheduled routine "${name}". The owner set this up earlier and is not here right now.]`,
    prompt.trim(),
    "",
    "Do this now with your reading tools. You may prepare drafts and Confirm cards (texts, campaigns, posts) for the owner to approve later, but book, change, send or post nothing yourself. Finish with a short report the owner can read on their phone: the figures or findings first, then anything waiting for their yes.",
  ].join("\n");
}

/** A short version of a long report for a notification. */
export function reportPreview(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
