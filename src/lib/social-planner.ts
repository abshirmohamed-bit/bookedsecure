/**
 * The social planner: pure rules shared by the server, the calendar and tests.
 *
 * A post moves draft → pending_approval → (owner approves) → scheduled or
 * publishing → published / failed. Anyone on the team can write and submit a
 * draft; only the owner approves, which is the one step that reaches Facebook
 * or Instagram.
 */

export const PLANNER_STATUSES = ["draft", "pending_approval", "scheduled", "publishing", "published", "failed", "cancelled"] as const;
export type PlannerStatus = (typeof PLANNER_STATUSES)[number];
export type PlannerPlatform = "facebook" | "instagram" | "linkedin" | "youtube";

export const STATUS_LABEL: Record<PlannerStatus, string> = {
  draft: "Draft", pending_approval: "Waiting for approval", scheduled: "Scheduled", publishing: "Publishing",
  published: "Published", failed: "Failed", cancelled: "Cancelled",
};

/** Normalised performance figures, whichever network they came from. */
export type PostInsights = {
  impressions: number | null; reach: number | null; views: number | null; clicks: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  /** Likes/reactions + comments + shares + saves. */
  engagements: number | null;
  /** YouTube Analytics, when the owner allowed it: minutes watched, and the average view in seconds and as a share of the video. */
  watchMinutes?: number | null; averageViewSeconds?: number | null; averageViewPercent?: number | null;
};

export type PlannerPost = {
  id: string; platform: PlannerPlatform; status: PlannerStatus; postsAs: string | null; text: string;
  pictures: number; plannedFor: string | null; publishedAt: string | null; createdAt: string;
  /** The day the calendar shows it on. */
  at: string;
  url: string | null; error: string | null; reviewNote: string | null; createdBy: string | null;
  insights: PostInsights | null; insightsAt: string | null;
};

/** The moment a post belongs to on the calendar: when it went out, else when it is planned, else when it was written. */
export function plannerAt(p: { published_at?: string | null; scheduled_for?: string | null; created_at: string }): string {
  return p.published_at ?? p.scheduled_for ?? p.created_at;
}

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
};

/** Facebook post fields + insights → figures. Missing metrics stay null, never 0. */
export function facebookInsights(body: Record<string, unknown>): PostInsights {
  const metric = (name: string) => {
    const data = ((body["insights"] as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> } | undefined)?.data) ?? [];
    const m = data.find((d) => d.name === name);
    return m ? n(m.values?.[0]?.value) : null;
  };
  const summary = (key: string) => n(((body[key] as { summary?: { total_count?: unknown } } | undefined)?.summary)?.total_count);
  const likes = summary("reactions");
  const comments = summary("comments");
  const shares = n((body["shares"] as { count?: unknown } | undefined)?.count) ?? (body["shares"] === undefined ? null : 0);
  const parts = [likes, comments, shares].filter((v): v is number => v !== null);
  return {
    impressions: metric("post_impressions"), reach: metric("post_impressions_unique"), views: null, clicks: metric("post_clicks"),
    likes, comments, shares, saves: null, engagements: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
  };
}

/** Instagram media fields + insights → figures. */
export function instagramInsights(media: Record<string, unknown>, insights: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }>): PostInsights {
  const metric = (name: string) => {
    const m = insights.find((d) => d.name === name);
    return m ? n(m.total_value?.value ?? m.values?.[0]?.value) : null;
  };
  const likes = n(media["like_count"]) ?? metric("likes");
  const comments = n(media["comments_count"]) ?? metric("comments");
  const shares = metric("shares");
  const saves = metric("saved");
  const parts = [likes, comments, shares, saves].filter((v): v is number => v !== null);
  return {
    impressions: null, reach: metric("reach"), views: metric("views"), clicks: null,
    likes, comments, shares, saves, engagements: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
  };
}

/** Engagements ÷ reach (or impressions), as a percentage. */
export function engagementRate(i: PostInsights | null): number | null {
  if (!i || i.engagements === null) return null;
  const base = i.reach ?? i.impressions ?? i.views;
  return base && base > 0 ? Math.round((i.engagements / base) * 1000) / 10 : null;
}

/** The weeks of a month as rows of seven days (Monday first), for the calendar. */
export function monthWeeks(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86400_000);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) row.push(new Date(start.getTime() + (w * 7 + d) * 86400_000).toISOString().slice(0, 10));
    weeks.push(row);
    const next = new Date(start.getTime() + (w * 7 + 7) * 86400_000);
    if (next.getUTCMonth() !== month - 1 && w >= 3) break;
  }
  return weeks;
}

/** A post's calendar day in the business's own timezone. */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
