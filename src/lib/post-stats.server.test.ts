import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; value: unknown; filters: [string, unknown][] }[],
  answers: {} as Record<string, Result>,
  scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"] as string[] | null,
  tokenFails: false,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const filters: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    const result = (): Result => state.answers[`${table}:${op}`] ?? { data: null, error: null };
    for (const m of ["select", "neq", "in", "is", "not", "lt", "gte", "lte", "limit", "order", "or"]) chain[m] = () => chain;
    chain["eq"] = (k: string, v: unknown) => { filters.push([k, v]); return chain; };
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = (v: unknown) => { op = m; state.writes.push({ table, op, value: v, filters }); return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

vi.mock("@/lib/youtube.server", () => ({
  youTubeAccessToken: async () => {
    if (state.tokenFails) throw new Error("YouTube isn't connected.");
    return { token: "tok", account: { scopes: state.scopes } };
  },
  YouTubeError: class extends Error {},
}));

import { recordPostSnapshots, refreshYouTubePostStats, sweepYouTubePostStats } from "./post-stats.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function youtube() {
  return vi.fn(async (url: string) => {
    if (url.includes("/youtube/v3/videos")) {
      return Response.json({ items: [
        { id: "vidA", statistics: { viewCount: "1000", likeCount: "50", commentCount: "5" } },
        { id: "vidB", statistics: { viewCount: "20" } },
      ] });
    }
    if (url.includes("youtubeanalytics")) return Response.json({ rows: [["vidA", 900, 400, 26, 58.5]] });
    return new Response("{}", { status: 404 });
  });
}
const snapshots = () => state.writes.filter((w) => w.table === "post_insight_snapshots").flatMap((w) => w.value as Record<string, unknown>[]);
const postUpdates = () => state.writes.filter((w) => w.table === "linkedin_posts" && w.op === "update");

beforeEach(() => {
  state.writes = [];
  state.answers = {};
  state.scopes = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
  state.tokenFails = false;
});

describe("reading a business's YouTube videos", () => {
  const posts = [{ id: P1, post_urn: "vidA", postedAt: ago(30) }, { id: P2, post_urn: "vidB", postedAt: ago(200) }];

  it("asks for all of them at once and keeps every figure", async () => {
    const fetcher = youtube();
    await refreshYouTubePostStats(BIZ, posts, fetcher as unknown as typeof fetch);
    const calls = fetcher.mock.calls.map(([u]) => String(u));
    expect(calls.filter((u) => u.includes("/videos?"))).toHaveLength(1);
    expect(calls.find((u) => u.includes("/videos?"))).toContain("id=vidA%2CvidB");
    const analytics = new URL(calls.find((u) => u.includes("youtubeanalytics"))!);
    expect(analytics.searchParams.get("dimensions")).toBe("video");
    expect(analytics.searchParams.get("filters")).toBe("video==vidA,vidB");
    expect(postUpdates()[0]?.value).toMatchObject({ insights: { views: 1000, likes: 50, comments: 5, engagements: 55, watchMinutes: 400, averageViewSeconds: 26, averageViewPercent: 58.5 } });
    expect(postUpdates()[0]?.filters).toEqual(expect.arrayContaining([["id", P1], ["business_id", BIZ]]));
    expect(snapshots()).toEqual([
      expect.objectContaining({ business_id: BIZ, post_id: P1, platform: "youtube", age_hours: 30 }),
      expect.objectContaining({ business_id: BIZ, post_id: P2, platform: "youtube", age_hours: 200, metrics: expect.objectContaining({ views: 20, watchMinutes: null }) }),
    ]);
  });

  it("still reads the public counts without the analytics permission", async () => {
    state.scopes = ["https://www.googleapis.com/auth/youtube.readonly"];
    const fetcher = youtube();
    await refreshYouTubePostStats(BIZ, posts, fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls.some(([u]) => String(u).includes("youtubeanalytics"))).toBe(false);
    expect(postUpdates()[0]?.value).toMatchObject({ insights: { views: 1000, watchMinutes: null } });
  });
});

describe("the scheduled sweep", () => {
  it("reads only posts that are due, grouped by business", async () => {
    state.answers["linkedin_posts:select"] = { data: [
      { id: P1, business_id: BIZ, post_urn: "vidA", status: "published", published_at: ago(30), scheduled_for: null, insights_at: null },
      { id: P2, business_id: BIZ, post_urn: "vidB", status: "published", published_at: ago(30), scheduled_for: null, insights_at: ago(1) },
    ], error: null };
    const fetcher = youtube();
    expect(await sweepYouTubePostStats(fetcher as unknown as typeof fetch)).toEqual({ refreshed: 1 });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("id=vidA&");
  });

  it("puts a business it can't read aside until next time", async () => {
    state.tokenFails = true;
    state.answers["linkedin_posts:select"] = { data: [
      { id: P1, business_id: BIZ, post_urn: "vidA", status: "published", published_at: ago(30), scheduled_for: null, insights_at: null },
    ], error: null };
    expect(await sweepYouTubePostStats(youtube() as unknown as typeof fetch)).toEqual({ refreshed: 0 });
    expect(postUpdates()[0]?.value).toEqual({ insights_at: expect.any(String) });
  });
});

describe("history never gets in the way", () => {
  it("drops snapshots quietly while the table doesn't exist yet", async () => {
    state.answers["post_insight_snapshots:insert"] = { data: null, error: { code: "PGRST205", message: "no table" } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordPostSnapshots(BIZ, [{ post_id: P1, platform: "youtube", age_hours: 1, metrics: {} as never }])).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
