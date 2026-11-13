/**
 * Clip learning, step 2: how posts did over time.
 *
 * Every read of a post's figures is kept as a snapshot with the post's age
 * (post_insight_snapshots, docs/clip-learning-stats.sql), so a clip's first
 * day can be compared with another's first day. Posts are read every 6 hours
 * in their first week, then daily, and not after 30 days. Pure.
 */
import type { PostInsights } from "@/lib/social-planner";

export const STATS_FOR_DAYS = 30;
const FIRST_WEEK_MS = 7 * 86_400_000;
const EARLY_EVERY_MS = 6 * 3600_000;
const LATER_EVERY_MS = 24 * 3600_000;

/**
 * When the post went out. A scheduled YouTube video is published by YouTube
 * itself (the app is never told), so its planned time stands in.
 */
export function postedAt(row: { status: string; published_at: string | null; scheduled_for: string | null }): string | null {
  if (row.published_at) return row.published_at;
  return row.status === "scheduled" ? row.scheduled_for : null;
}

export function statsDue(posted: string | null, readAt: string | null, now: Date = new Date()): boolean {
  const at = posted ? Date.parse(posted) : Number.NaN;
  if (!Number.isFinite(at) || at > now.getTime()) return false;
  const age = now.getTime() - at;
  if (age > STATS_FOR_DAYS * 86_400_000) return false;
  if (!readAt) return true;
  const since = now.getTime() - Date.parse(readAt);
  return !(since < (age < FIRST_WEEK_MS ? EARLY_EVERY_MS : LATER_EVERY_MS));
}

const count = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export type YouTubeVideoAnalytics = { views: number; minutes: number; averageViewSeconds: number; averageViewPercent: number };

/** videos.list statistics plus the video's YouTube Analytics row → the same figures as Facebook and Instagram posts. */
export function youtubeInsights(stats: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } | undefined, analytics: YouTubeVideoAnalytics | null): PostInsights {
  const likes = count(stats?.likeCount);
  const comments = count(stats?.commentCount);
  const parts = [likes, comments].filter((v): v is number => v !== null);
  return {
    impressions: null, reach: null, views: count(stats?.viewCount), clicks: null,
    likes, comments, shares: null, saves: null, engagements: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
    watchMinutes: analytics ? analytics.minutes : null,
    averageViewSeconds: analytics ? analytics.averageViewSeconds : null,
    averageViewPercent: analytics ? analytics.averageViewPercent : null,
  };
}

export type PostSnapshot = { post_id: string; platform: string; age_hours: number; metrics: PostInsights };

export function snapshotOf(post: { id: string; platform: string; postedAt: string | null }, insights: PostInsights, now: Date = new Date()): PostSnapshot {
  const at = post.postedAt ? Date.parse(post.postedAt) : Number.NaN;
  return { post_id: post.id, platform: post.platform, age_hours: Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 3600_000)) : 0, metrics: insights };
}
