/**
 * Clip learning, step 2: reading posted videos' figures and keeping their history.
 *
 * YouTube uses only the official APIs with the business's own grant: one
 * videos.list call (1 quota unit for up to 50 videos) for views, likes and
 * comments, and, when the owner allowed yt-analytics.readonly, one YouTube
 * Analytics report per business for watch time and average view duration
 * and percentage. Facebook and Instagram keep their own reader
 * (social-planner refreshPostInsights), which records a snapshot here too.
 * Snapshots never get in the way: until docs/clip-learning-stats.sql is
 * applied they are skipped with one warning.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { youTubeAccessToken } from "@/lib/youtube.server";
import { hasYouTubeScope } from "@/lib/youtube";
import { postedAt, type PostSnapshot, snapshotOf, STATS_FOR_DAYS, statsDue, youtubeInsights, type YouTubeVideoAnalytics } from "@/lib/post-stats";
import { MISSING_SCHEMA } from "@/lib/clip-learning.server";

const db = () => supabaseAdmin as unknown as SupabaseClient;
/** videos.list and an Analytics filter take at most 50 ids at a time. */
const BATCH = 50;
/** Businesses read per sweep; the rest wait for the next 10-minute run. */
const BUSINESSES_PER_SWEEP = 8;

let warned = false;

/** Keeps a read of some posts' figures. Never throws. */
export async function recordPostSnapshots(businessId: string, rows: PostSnapshot[]): Promise<void> {
  if (!rows.length) return;
  try {
    const { error } = await db().from("post_insight_snapshots").insert(rows.map((r) => ({ business_id: businessId, ...r })));
    if (!error) return;
    if (MISSING_SCHEMA.has(error.code ?? "")) {
      if (!warned) { warned = true; console.warn("post_insight_snapshots is missing: apply docs/clip-learning-stats.sql (drizzle 0066); post history isn't kept until then"); }
    } else console.error("post snapshots", error.message);
  } catch (e) {
    console.error("post snapshots", e);
  }
}

async function getJson(url: string, token: string, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`YouTube answered ${res.status} for ${new URL(url).pathname}`);
  return res.json();
}

const VideosList = z.object({ items: z.array(z.object({
  id: z.string(),
  statistics: z.object({ viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional() }).optional(),
})).default([]) });
const Report = z.object({ rows: z.array(z.array(z.union([z.string(), z.number()]))).optional() });
const day = (iso: string) => iso.slice(0, 10);

export type YouTubePostRef = { id: string; post_urn: string; postedAt: string | null };

/** Reads up to 50 of one business's YouTube videos, stores the latest figures on each post and keeps a snapshot. */
export async function refreshYouTubePostStats(businessId: string, posts: YouTubePostRef[], fetcher: typeof fetch = fetch): Promise<number> {
  const batch = posts.slice(0, BATCH);
  if (!batch.length) return 0;
  const { token, account } = await youTubeAccessToken(businessId, fetcher);
  const ids = batch.map((p) => p.post_urn);
  const list = VideosList.safeParse(await getJson(
    `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "statistics", id: ids.join(","), maxResults: String(BATCH) })}`, token, fetcher));
  const stats = new Map((list.success ? list.data.items : []).map((v) => [v.id, v.statistics]));

  const watched = new Map<string, YouTubeVideoAnalytics>();
  if (hasYouTubeScope((account as { scopes?: string[] | null }).scopes ?? null, "yt-analytics.readonly")) {
    const earliest = batch.map((p) => p.postedAt).filter((v): v is string => Boolean(v)).sort()[0] ?? new Date().toISOString();
    const q = new URLSearchParams({
      ids: "channel==MINE", startDate: day(earliest), endDate: day(new Date().toISOString()),
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage", dimensions: "video", filters: `video==${ids.join(",")}`,
    });
    try {
      const rep = Report.safeParse(await getJson(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`, token, fetcher));
      for (const r of rep.success ? rep.data.rows ?? [] : []) {
        watched.set(String(r[0]), { views: Number(r[1]) || 0, minutes: Number(r[2]) || 0, averageViewSeconds: Number(r[3]) || 0, averageViewPercent: Number(r[4]) || 0 });
      }
    } catch (e) {
      console.error("youtube analytics per video", e); // The public counts are still kept.
    }
  }

  const now = new Date();
  const snaps: PostSnapshot[] = [];
  for (const p of batch) {
    const insights = youtubeInsights(stats.get(p.post_urn), watched.get(p.post_urn) ?? null);
    await db().from("linkedin_posts").update({ insights, insights_at: now.toISOString() }).eq("id", p.id).eq("business_id", businessId);
    if (stats.has(p.post_urn)) snaps.push(snapshotOf({ id: p.id, platform: "youtube", postedAt: p.postedAt }, insights, now));
  }
  await recordPostSnapshots(businessId, snaps);
  return batch.length;
}

type SweepRow = { id: string; business_id: string; post_urn: string; status: string; published_at: string | null; scheduled_for: string | null; insights_at: string | null };

/** From the follow-ups hook: YouTube videos posted in the last 30 days, read on statsDue's schedule. */
export async function sweepYouTubePostStats(fetcher: typeof fetch = fetch): Promise<{ refreshed: number }> {
  const since = new Date(Date.now() - STATS_FOR_DAYS * 86_400_000).toISOString();
  const { data, error } = await db().from("linkedin_posts").select("id, business_id, post_urn, status, published_at, scheduled_for, insights_at")
    .eq("platform", "youtube").in("status", ["published", "scheduled"]).not("post_urn", "is", null)
    .or(`published_at.gte.${since},scheduled_for.gte.${since}`).order("insights_at", { ascending: true, nullsFirst: true }).limit(400);
  if (error) return { refreshed: 0 };
  const due = new Map<string, YouTubePostRef[]>();
  for (const row of (data ?? []) as SweepRow[]) {
    const at = postedAt(row);
    if (!statsDue(at, row.insights_at)) continue;
    const list = due.get(row.business_id) ?? [];
    list.push({ id: row.id, post_urn: row.post_urn, postedAt: at });
    due.set(row.business_id, list);
  }
  let refreshed = 0;
  for (const [businessId, posts] of [...due].slice(0, BUSINESSES_PER_SWEEP)) {
    try {
      refreshed += await refreshYouTubePostStats(businessId, posts, fetcher);
    } catch (e) {
      // Disconnected, signed out or over quota: try again on the normal schedule, not every 10 minutes.
      console.error("youtube post stats", businessId, e instanceof Error ? e.message : e);
      await db().from("linkedin_posts").update({ insights_at: new Date().toISOString() }).in("id", posts.slice(0, BATCH).map((p) => p.id)).eq("business_id", businessId);
    }
  }
  return { refreshed };
}
