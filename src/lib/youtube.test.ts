import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildYouTubeAuthorizeUrl, chunkRange, isYouTubeUploadUrl, nextByteFrom, splitDraft, videoProblem, videoStatus, YOUTUBE_CHUNK_BYTES } from "./youtube";

const state = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  post: { scheduled_for: null } as Record<string, unknown>,
  writes: [] as { table: string; op: string; value: unknown }[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "youtube_accounts") return { data: state.account, error: null };
      if (table === "linkedin_posts" && op === "insert") return { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null };
      if (table === "linkedin_posts") return { data: state.post, error: null };
      return { data: null, error: null };
    };
    for (const m of ["select", "eq", "neq", "gte", "limit", "order", "in"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = (value: unknown) => { op = m; state.writes.push({ table, op, value }); return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown) => resolve(result());
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

process.env["YOUTUBE_CLIENT_ID"] = "client";
process.env["YOUTUBE_CLIENT_SECRET"] = "secret";
process.env["TENANT_AI_ENCRYPTION_SECRET"] = "test-secret-for-youtube";

import { encryptMetaToken } from "./meta-oauth.server";
import { signYouTubeState, signYouTubeTicket, startYouTubeUpload, uploadYouTubeChunk, verifyYouTubeState, verifyYouTubeTicket } from "./youtube.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc";

beforeEach(() => {
  state.writes = [];
  state.post = { scheduled_for: null };
  state.account = {
    business_id: BIZ,
    channel_id: "UC123",
    channel_title: "Glocast",
    refresh_token_ciphertext: encryptMetaToken("refresh-1", `youtube:${BIZ}`),
    access_token_ciphertext: encryptMetaToken("access-1", `youtube-access:${BIZ}`),
    access_token_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    connected_at: new Date().toISOString(),
  };
});

describe("YouTube rules", () => {
  it("asks Google for offline upload access", () => {
    const url = new URL(buildYouTubeAuthorizeUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
  });
  it("only trusts YouTube's own upload address", () => {
    expect(isYouTubeUploadUrl(SESSION)).toBe(true);
    expect(isYouTubeUploadUrl("https://evil.com/upload/youtube/v3/videos?upload_id=a")).toBe(false);
    expect(isYouTubeUploadUrl("https://www.googleapis.com/upload/youtube/v3/videos")).toBe(false);
  });
  it("checks titles, sizes and file types", () => {
    expect(videoProblem({ title: "", description: "", fileSize: 10, mimeType: "video/mp4" })).toMatch(/title/);
    expect(videoProblem({ title: "a<b", description: "", fileSize: 10, mimeType: "video/mp4" })).toMatch(/< or >/);
    expect(videoProblem({ title: "ok", description: "", fileSize: 10, mimeType: "image/png" })).toMatch(/isn't a video/);
    expect(videoProblem({ title: "ok", description: "", fileSize: 10, mimeType: "video/mp4" })).toBeNull();
  });
  it("schedules as private with a publish time", () => {
    expect(videoStatus("unlisted", "2030-01-01T00:00:00.000Z", false)).toEqual({ privacyStatus: "private", publishAt: "2030-01-01T00:00:00.000Z", selfDeclaredMadeForKids: false });
    expect(videoStatus("unlisted", null, true)).toEqual({ privacyStatus: "unlisted", selfDeclaredMadeForKids: true });
  });
  it("builds content ranges that follow the 256 KiB rule", () => {
    expect(chunkRange(0, YOUTUBE_CHUNK_BYTES, 20_000_000)).toBe(`bytes 0-${YOUTUBE_CHUNK_BYTES - 1}/20000000`);
    expect(chunkRange(0, 1000, 20_000_000)).toBeNull();
    expect(chunkRange(19_999_000, 1000, 20_000_000)).toBe("bytes 19999000-19999999/20000000");
    expect(chunkRange(19_999_000, 1001, 20_000_000)).toBeNull();
    expect(nextByteFrom("bytes=0-8388607")).toBe(8388608);
    expect(nextByteFrom(null)).toBe(0);
  });
  it("splits an AI draft into title and description", () => {
    expect(splitDraft("Title: Black Mazda gets a ceramic coat\n\nWe coated it.\n#detailing")).toEqual({ title: "Black Mazda gets a ceramic coat", description: "We coated it.\n#detailing" });
  });
});

describe("YouTube signed state and tickets", () => {
  it("round-trips and rejects tampering or expiry", () => {
    const s = signYouTubeState({ businessId: BIZ, userId: USER });
    expect(verifyYouTubeState(s)).toEqual({ businessId: BIZ, userId: USER });
    expect(verifyYouTubeState(`${s}x`)).toBeNull();
    expect(verifyYouTubeState(s, Date.now() + 60 * 60_000)).toBeNull();
    const t = signYouTubeTicket({ businessId: BIZ, userId: USER, url: SESSION, postId: POST, size: 100 });
    expect(verifyYouTubeTicket(t)?.size).toBe(100);
    expect(verifyYouTubeTicket(signYouTubeTicket({ businessId: BIZ, userId: USER, url: "https://evil.com/x", postId: POST, size: 1 }))).toBeNull();
  });
});

describe("YouTube upload", () => {
  it("records the video and opens a resumable session", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200, headers: { Location: SESSION } }));
    const r = await startYouTubeUpload({ businessId: BIZ, userId: USER, title: "Ceramic coat", description: "Done", privacy: "public", madeForKids: false, fileSize: 1000, mimeType: "video/mp4", source: "app", fetcher: fetcher as unknown as typeof fetch });
    expect(r.postId).toBe(POST);
    expect(verifyYouTubeTicket(r.ticket)?.url).toBe(SESSION);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer access-1");
    expect(JSON.parse(String(init.body)).status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false });
    expect(state.writes.find((w) => w.op === "insert")?.value).toMatchObject({ platform: "youtube", status: "publishing", author_urn: "youtube:UC123" });
  });

  it("marks the row failed when YouTube refuses", async () => {
    const fetcher = vi.fn(async () => new Response("{\"error\":{\"errors\":[{\"reason\":\"quotaExceeded\"}]}}", { status: 403 }));
    await expect(startYouTubeUpload({ businessId: BIZ, userId: USER, title: "x", description: "", privacy: "public", madeForKids: false, fileSize: 1000, mimeType: "video/mp4", source: "app", fetcher: fetcher as unknown as typeof fetch }))
      .rejects.toThrow(/daily upload limit/);
    expect(state.writes.some((w) => w.op === "update" && (w.value as { status?: string }).status === "failed")).toBe(true);
  });

  it("refreshes an expired access token", async () => {
    state.account!["access_token_expires_at"] = new Date(Date.now() - 1000).toISOString();
    const fetcher = vi.fn(async (url: string) => url.startsWith("https://oauth2")
      ? Response.json({ access_token: "access-2-fresh", expires_in: 3600 })
      : new Response(null, { status: 200, headers: { Location: SESSION } }));
    await startYouTubeUpload({ businessId: BIZ, userId: USER, title: "x", description: "", privacy: "public", madeForKids: false, fileSize: 1000, mimeType: "video/mp4", source: "app", fetcher: fetcher as unknown as typeof fetch });
    const upload = fetcher.mock.calls.find(([u]) => String(u).includes("/upload/")) as unknown as [string, RequestInit];
    expect((upload[1].headers as Record<string, string>)["Authorization"]).toBe("Bearer access-2-fresh");
  });

  it("sends pieces and saves the finished video", async () => {
    const size = YOUTUBE_CHUNK_BYTES + 10;
    const ticket = signYouTubeTicket({ businessId: BIZ, userId: USER, url: SESSION, postId: POST, size });
    const mid = vi.fn(async () => new Response(null, { status: 308, headers: { Range: `bytes=0-${YOUTUBE_CHUNK_BYTES - 1}` } }));
    expect(await uploadYouTubeChunk({ ticket, userId: USER, start: 0, bytes: new ArrayBuffer(YOUTUBE_CHUNK_BYTES), fetcher: mid as unknown as typeof fetch }))
      .toEqual({ done: false, nextByte: YOUTUBE_CHUNK_BYTES });
    const end = vi.fn(async () => Response.json({ id: "vid123" }));
    const r = await uploadYouTubeChunk({ ticket, userId: USER, start: YOUTUBE_CHUNK_BYTES, bytes: new ArrayBuffer(10), fetcher: end as unknown as typeof fetch });
    expect(r).toEqual({ done: true, videoId: "vid123", url: "https://www.youtube.com/watch?v=vid123" });
    expect(state.writes.find((w) => w.op === "update")?.value).toMatchObject({ status: "published", post_urn: "vid123" });
  });

  it("refuses another user's ticket", async () => {
    const ticket = signYouTubeTicket({ businessId: BIZ, userId: USER, url: SESSION, postId: POST, size: 10 });
    await expect(uploadYouTubeChunk({ ticket, userId: "44444444-4444-4444-8444-444444444444", start: 0, bytes: new ArrayBuffer(10) })).rejects.toThrow(/expired/);
  });
});

import { hasYouTubeScope, isoDurationSeconds } from "./youtube";
import { channelInsights, listYouTubeComments, replyToYouTubeComment } from "./youtube-insights.server";

describe("YouTube insights", () => {
  it("reads ISO durations and scopes", () => {
    expect(isoDurationSeconds("PT4M")).toBe(240);
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(isoDurationSeconds("P1DT1S")).toBe(86401);
    expect(isoDurationSeconds("bad")).toBe(0);
    expect(hasYouTubeScope(["https://www.googleapis.com/auth/youtube.force-ssl"], "youtube.force-ssl")).toBe(true);
    expect(hasYouTubeScope(null, "yt-analytics.readonly")).toBe(false);
  });

  it("classifies uploads by the 4-minute rule and sums analytics", async () => {
    state.account!["scopes"] = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/channels")) return Response.json({ items: [{ id: "UC123", snippet: { title: "Glocast" }, statistics: { viewCount: "5000", subscriberCount: "120", videoCount: "2" }, contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] });
      if (url.includes("/playlistItems")) return Response.json({ items: [{ contentDetails: { videoId: "a" } }, { contentDetails: { videoId: "b" } }] });
      if (url.includes("/videos")) return Response.json({ items: [
        { id: "a", snippet: { title: "Full detail", publishedAt: "2026-11-01T00:00:00Z" }, contentDetails: { duration: "PT8M" }, statistics: { viewCount: "300" } },
        { id: "b", snippet: { title: "Quick tip", publishedAt: "2026-11-05T00:00:00Z" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "900" } },
      ] });
      if (url.includes("youtubeanalytics")) return Response.json({ rows: [["2026-11-01", 10, 60, 2, 1, 30], ["2026-11-02", 30, 120, 1, 0, 50]] });
      return new Response(null, { status: 404 });
    });
    const r = await channelInsights(BIZ, fetcher as unknown as typeof fetch);
    expect(r.channel).toMatchObject({ subscribers: 120, views: 5000, videos: 2 });
    expect(r.recent.map((v) => [v.id, v.form])).toEqual([["b", "short"], ["a", "long"]]);
    expect(r.last28).toMatchObject({ views: 40, watchHours: 3, subscribersGained: 3, subscribersLost: 1, averageViewSeconds: 45 });
    expect(r.commentsNeedReconnect).toBe(true);
  });

  it("lists comments, skips the channel's own and marks answered threads", async () => {
    state.account!["scopes"] = ["https://www.googleapis.com/auth/youtube.force-ssl"];
    const fetcher = vi.fn(async (url: string) => url.includes("/commentThreads")
      ? Response.json({ items: [
        { id: "t1", snippet: { videoId: "a", totalReplyCount: 1, topLevelComment: { id: "c1", snippet: { authorDisplayName: "Sam", authorChannelId: { value: "UCfan" }, textOriginal: "How much?" } } }, replies: { comments: [{ snippet: { authorChannelId: { value: "UC123" } } }] } },
        { id: "t2", snippet: { videoId: "a", topLevelComment: { id: "c2", snippet: { authorChannelId: { value: "UC123" }, textOriginal: "Pinned" } } } },
      ] })
      : Response.json({ items: [{ id: "a", snippet: { title: "Full detail" } }] }));
    const r = await listYouTubeComments(BIZ, fetcher as unknown as typeof fetch);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ commentId: "c1", answered: true, videoTitle: "Full detail" });
  });

  it("needs the comments permission to reply", async () => {
    state.account!["scopes"] = ["https://www.googleapis.com/auth/youtube.readonly"];
    await expect(replyToYouTubeComment({ businessId: BIZ, userId: USER, parentId: "Ugxabcdefghij", text: "Thanks!" })).rejects.toThrow(/Reconnect/);
  });
});
