import { describe, expect, it } from "vitest";
import { postedAt, snapshotOf, statsDue, youtubeInsights } from "@/lib/post-stats";

const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("when a post's figures are read again", () => {
  it("reads a post that was never read", () => {
    expect(statsDue(hoursAgo(1), null, NOW)).toBe(true);
  });
  it("reads a new post every 6 hours in its first week", () => {
    expect(statsDue(hoursAgo(48), hoursAgo(5), NOW)).toBe(false);
    expect(statsDue(hoursAgo(48), hoursAgo(7), NOW)).toBe(true);
  });
  it("reads an older post once a day", () => {
    expect(statsDue(hoursAgo(10 * 24), hoursAgo(12), NOW)).toBe(false);
    expect(statsDue(hoursAgo(10 * 24), hoursAgo(25), NOW)).toBe(true);
  });
  it("stops after 30 days", () => {
    expect(statsDue(hoursAgo(31 * 24), hoursAgo(48), NOW)).toBe(false);
  });
  it("waits for a scheduled post to go out", () => {
    expect(statsDue(new Date(NOW.getTime() + 3600_000).toISOString(), null, NOW)).toBe(false);
    expect(statsDue(null, null, NOW)).toBe(false);
  });
});

describe("when a post went out", () => {
  it("is when it was published", () => {
    expect(postedAt({ status: "published", published_at: "2026-11-01T00:00:00Z", scheduled_for: null })).toBe("2026-11-01T00:00:00Z");
  });
  it("is the planned time for a YouTube video YouTube publishes by itself", () => {
    expect(postedAt({ status: "scheduled", published_at: null, scheduled_for: "2026-11-02T00:00:00Z" })).toBe("2026-11-02T00:00:00Z");
  });
  it("is unknown for anything else", () => {
    expect(postedAt({ status: "failed", published_at: null, scheduled_for: "2026-11-02T00:00:00Z" })).toBeNull();
  });
});

describe("a YouTube video's figures", () => {
  it("joins the public counts with how long people watched", () => {
    expect(youtubeInsights({ viewCount: "1200", likeCount: "80", commentCount: "12" }, { views: 1100, minutes: 500, averageViewSeconds: 27, averageViewPercent: 61.4 })).toEqual({
      impressions: null, reach: null, views: 1200, clicks: null, likes: 80, comments: 12, shares: null, saves: null, engagements: 92,
      watchMinutes: 500, averageViewSeconds: 27, averageViewPercent: 61.4,
    });
  });
  it("leaves watch time empty without YouTube Analytics", () => {
    expect(youtubeInsights({ viewCount: "5" }, null)).toMatchObject({ views: 5, likes: null, comments: null, engagements: null, watchMinutes: null, averageViewPercent: null });
  });
  it("is all empty when YouTube no longer has the video", () => {
    expect(youtubeInsights(undefined, null).views).toBeNull();
  });
});

describe("a snapshot", () => {
  it("carries the post's age so clips of different ages compare fairly", () => {
    const insights = youtubeInsights({ viewCount: "10" }, null);
    expect(snapshotOf({ id: "p1", platform: "youtube", postedAt: hoursAgo(30.4) }, insights, NOW)).toEqual({ post_id: "p1", platform: "youtube", age_hours: 30, metrics: insights });
  });
});
