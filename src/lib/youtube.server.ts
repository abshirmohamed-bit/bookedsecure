import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptMetaToken, encryptMetaToken } from "./meta-oauth.server";
import {
  YOUTUBE_CALLBACK_PATH,
  buildYouTubeAuthorizeUrl,
  chunkRange,
  isYouTubeUploadUrl,
  nextByteFrom,
  videoProblem,
  videoStatus,
  youtubeVideoUrl,
  type YouTubePrivacy,
} from "./youtube";

/**
 * Per-business YouTube connection and video uploads through the official
 * YouTube Data API v3. Platform app credentials come from server secrets
 * (Google_Console_Client_ID / Google_Console_Client_Secret); each business signs in with its
 * own Google account and only the encrypted refresh token is kept, bound to
 * that business (server-only table youtube_accounts, docs/youtube.sql).
 */

// youtube_accounts is not in the generated types until Lovable applies docs/youtube.sql.
const db = () => supabaseAdmin as unknown as SupabaseClient;

export type YouTubeConfig = { clientId?: string | undefined; clientSecret?: string | undefined; appUrl: string };

export function readYouTubeConfig(): YouTubeConfig {
  return {
    // Lovable secrets are named Google_Console_Client_ID / _Secret; YOUTUBE_* still works.
    clientId: (process.env["Google_Console_Client_ID"] ?? process.env["YOUTUBE_CLIENT_ID"])?.trim() || undefined,
    clientSecret: (process.env["Google_Console_Client_Secret"] ?? process.env["YOUTUBE_CLIENT_SECRET"])?.trim() || undefined,
    appUrl: (process.env["PUBLIC_APP_URL"]?.trim() || "https://bookedsecure.com").replace(/\/+$/, ""),
  };
}

/** Names (never values) of the platform settings YouTube still needs. */
export function youTubeMissingSettings(config = readYouTubeConfig()): string[] {
  return [
    config.clientId ? null : "Google_Console_Client_ID",
    config.clientSecret ? null : "Google_Console_Client_Secret",
    process.env["TENANT_AI_ENCRYPTION_SECRET"] ? null : "TENANT_AI_ENCRYPTION_SECRET",
  ].filter((name): name is string => name !== null);
}

function assertReady(config: YouTubeConfig) {
  if (!config.clientId || !config.clientSecret) throw new Error("YouTube isn't set up on BookedSecure yet (Google_Console_Client_ID / Google_Console_Client_Secret).");
  if (!process.env["TENANT_AI_ENCRYPTION_SECRET"]) throw new Error("Secure token storage is unavailable.");
}

const refreshContext = (businessId: string) => `youtube:${businessId}`;
const accessContext = (businessId: string) => `youtube-access:${businessId}`;
const missingTable = (code?: string) => code === "PGRST205" || code === "42P01";

/** A failure tagged with the step and HTTP status; never carries tokens or provider text. */
export class YouTubeError extends Error {
  constructor(message: string, readonly step: string, readonly status?: number) { super(message); }
  get reason(): string { return [this.step, this.status].filter((x) => x !== undefined).join("-"); }
}

async function call(url: string, init: RequestInit, step: string, fetcher: typeof fetch, timeoutMs = 15_000): Promise<Response> {
  try {
    return await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new YouTubeError("YouTube could not be reached. Please try again.", `${step}_unreachable`);
  }
}

// ----- Signed OAuth state: binds the callback to the owner who started it -----

const STATE_TTL_MS = 15 * 60_000;
const hmacKey = (purpose: string) => createHash("sha256").update(`${purpose}:${process.env["TENANT_AI_ENCRYPTION_SECRET"] ?? ""}`).digest();

function sign(purpose: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", hmacKey(purpose)).update(body).digest("base64url")}`;
}

function verify(purpose: string, token: string): unknown {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", hmacKey(purpose)).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

export function signYouTubeState(payload: { businessId: string; userId: string }, now = Date.now()): string {
  return sign("youtube-oauth-state", { b: payload.businessId, u: payload.userId, e: now + STATE_TTL_MS, n: randomBytes(8).toString("hex") });
}

export function verifyYouTubeState(state: string, now = Date.now()): { businessId: string; userId: string } | null {
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), e: z.number() }).safeParse(verify("youtube-oauth-state", state));
  if (!parsed.success || parsed.data.e < now) return null;
  return { businessId: parsed.data.b, userId: parsed.data.u };
}

export function youTubeLoginUrl(businessId: string, userId: string, config = readYouTubeConfig()): string {
  assertReady(config);
  return buildYouTubeAuthorizeUrl({
    clientId: config.clientId!,
    redirectUri: `${config.appUrl}${YOUTUBE_CALLBACK_PATH}`,
    state: signYouTubeState({ businessId, userId }),
  });
}

// ----- Connecting -----

const tokenResponse = z.object({ access_token: z.string().min(10), expires_in: z.number().optional(), refresh_token: z.string().optional(), scope: z.string().optional() });
const channelList = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({ title: z.string().optional(), customUrl: z.string().optional(), thumbnails: z.record(z.string(), z.object({ url: z.string() })).optional() }).optional(),
  })).default([]),
});

async function readChannel(accessToken: string, fetcher: typeof fetch) {
  const res = await call("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } }, "channel", fetcher);
  const body = channelList.safeParse(res.ok ? await res.json().catch(() => null) : null);
  if (!body.success) throw new YouTubeError("YouTube didn't share your channel. Please try again.", "channel", res.status);
  const channel = body.data.items[0];
  if (!channel) throw new YouTubeError("This Google account has no YouTube channel yet. Create one on youtube.com, then connect again.", "no_channel");
  const thumbs = channel.snippet?.thumbnails ?? {};
  return {
    id: channel.id,
    title: channel.snippet?.title?.slice(0, 200) ?? "Your channel",
    handle: channel.snippet?.customUrl?.slice(0, 100) ?? null,
    thumbnail: thumbs["default"]?.url ?? thumbs["medium"]?.url ?? null,
  };
}

/**
 * Finishes the Google sign-in. The signed state names the business and owner;
 * ownership is re-checked because the callback carries no BookedSecure session.
 */
export async function completeYouTubeConnect(code: string, state: string, fetcher: typeof fetch = fetch): Promise<"connected"> {
  const who = verifyYouTubeState(state);
  if (!who) throw new Error("This YouTube sign-in link has expired. Please connect again.");
  const { requireAppContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireAppContext(supabaseAdmin, who.userId).catch(() => { throw new YouTubeError("Your BookedSecure account could not be checked.", "owner"); });
  try { requireOwner(ctx); } catch { throw new YouTubeError("Only the business owner can connect YouTube.", "owner"); }
  if (ctx.businessId !== who.businessId) throw new YouTubeError("This YouTube sign-in belongs to a different business.", "owner_business");

  const config = readYouTubeConfig();
  assertReady(config);
  const tokenRes = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.appUrl}${YOUTUBE_CALLBACK_PATH}`, client_id: config.clientId!, client_secret: config.clientSecret! }),
  }, "token", fetcher);
  const token = tokenResponse.safeParse(tokenRes.ok ? await tokenRes.json().catch(() => null) : null);
  if (!token.success) throw new YouTubeError("Google did not accept the sign-in. Please try again.", "token", tokenRes.status);
  const scopes = (token.data.scope ?? "").split(/[\s,]+/).filter(Boolean);
  if (!scopes.some((s) => s.endsWith("/youtube.upload") || s.endsWith("/youtube"))) {
    throw new YouTubeError("Please tick \"Manage your YouTube videos\" when Google asks, so BookedSecure can upload.", "scope_missing");
  }
  if (!token.data.refresh_token) throw new YouTubeError("Google didn't give lasting access. Remove BookedSecure under your Google account's third-party access, then connect again.", "no_refresh");
  const channel = await readChannel(token.data.access_token, fetcher);

  const now = new Date();
  const { error } = await db().from("youtube_accounts").upsert({
    business_id: who.businessId,
    channel_id: channel.id,
    channel_title: channel.title,
    channel_handle: channel.handle,
    channel_thumbnail: channel.thumbnail,
    refresh_token_ciphertext: encryptMetaToken(token.data.refresh_token, refreshContext(who.businessId)),
    access_token_ciphertext: encryptMetaToken(token.data.access_token, accessContext(who.businessId)),
    access_token_expires_at: new Date(now.getTime() + (token.data.expires_in ?? 3600) * 1000).toISOString(),
    scopes,
    connected_by: who.userId,
    connected_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "business_id" });
  if (error) throw new YouTubeError(missingTable(error.code) ? "YouTube is waiting for a one-time database update." : "Could not save the YouTube connection.", "save");
  await supabaseAdmin.from("audit_events").insert({ business_id: who.businessId, user_id: who.userId, event_type: "youtube_connected", entity_type: "business", entity_id: who.businessId, metadata: { channel: channel.id } });
  return "connected";
}

type AccountRow = {
  business_id: string;
  channel_id: string;
  channel_title: string | null;
  channel_handle: string | null;
  channel_thumbnail: string | null;
  refresh_token_ciphertext: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  connected_at: string;
};

async function loadAccount(businessId: string): Promise<AccountRow | null> {
  const { data, error } = await db().from("youtube_accounts")
    .select("business_id, channel_id, channel_title, channel_handle, channel_thumbnail, refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at, connected_at")
    .eq("business_id", businessId).maybeSingle();
  if (error) {
    if (missingTable(error.code)) return null;
    throw new Error("Could not load the YouTube connection.");
  }
  return (data as AccountRow | null) ?? null;
}

/** A current access token: the cached one, or a fresh one from the refresh token. */
async function accessToken(businessId: string, fetcher: typeof fetch = fetch): Promise<{ token: string; account: AccountRow }> {
  const account = await loadAccount(businessId);
  if (!account) throw new Error("YouTube isn't connected. Connect it under Social media → YouTube first.");
  const expires = account.access_token_expires_at ? Date.parse(account.access_token_expires_at) : 0;
  if (account.access_token_ciphertext && expires - Date.now() > 3 * 60_000) {
    try { return { token: decryptMetaToken(account.access_token_ciphertext, accessContext(businessId)), account }; } catch { /* refresh below */ }
  }
  const config = readYouTubeConfig();
  assertReady(config);
  let refresh: string;
  try { refresh = decryptMetaToken(account.refresh_token_ciphertext, refreshContext(businessId)); } catch { throw new Error("YouTube needs to be reconnected."); }
  const res = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: config.clientId!, client_secret: config.clientSecret! }),
  }, "refresh", fetcher);
  const body = tokenResponse.safeParse(res.ok ? await res.json().catch(() => null) : null);
  if (!body.success) {
    if (res.status === 400 || res.status === 401) throw new Error("YouTube signed you out. Reconnect YouTube and try again.");
    throw new YouTubeError(`Google couldn't renew the YouTube access (${res.status}).`, "refresh", res.status);
  }
  await db().from("youtube_accounts").update({
    access_token_ciphertext: encryptMetaToken(body.data.access_token, accessContext(businessId)),
    access_token_expires_at: new Date(Date.now() + (body.data.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("business_id", businessId);
  return { token: body.data.access_token, account };
}

// ----- Status, posts, disconnect -----

export type YouTubeVideoPost = {
  id: string;
  title: string;
  status: "uploading" | "scheduled" | "published" | "failed";
  privacy: YouTubePrivacy | null;
  publishAt: string | null;
  url: string | null;
  error: string | null;
  createdAt: string;
};

const STALE_UPLOAD_MS = 12 * 60 * 60_000;

export async function listYouTubeVideos(businessId: string, limit = 20): Promise<YouTubeVideoPost[]> {
  const { data, error } = await db().from("linkedin_posts")
    .select("id, body_text, status, permalink, error, created_at, scheduled_for, payload")
    .eq("business_id", businessId).eq("platform", "youtube").order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 50));
  if (error) return [];
  const now = Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const payload = (r["payload"] ?? {}) as { title?: string; privacy?: YouTubePrivacy };
    const raw = String(r["status"]);
    const publishAt = (r["scheduled_for"] as string | null) ?? null;
    const createdAt = String(r["created_at"]);
    let status: YouTubeVideoPost["status"] = raw === "published" ? "published" : raw === "failed" || raw === "cancelled" ? "failed" : raw === "scheduled" ? "scheduled" : "uploading";
    if (status === "scheduled" && publishAt && Date.parse(publishAt) <= now) status = "published";
    const stale = status === "uploading" && now - Date.parse(createdAt) > STALE_UPLOAD_MS;
    return {
      id: String(r["id"]),
      title: payload.title ?? String(r["body_text"] ?? "").split("\n")[0] ?? "",
      status: stale ? "failed" : status,
      privacy: payload.privacy ?? null,
      publishAt,
      url: (r["permalink"] as string | null) ?? null,
      error: stale ? "The upload didn't finish." : (r["error"] as string | null) ?? null,
      createdAt,
    };
  });
}

/** What the owner sees: whether YouTube is set up and which channel. Never a token. */
export async function youTubeStatus(businessId: string) {
  const config = readYouTubeConfig();
  const { error: tableError } = await db().from("youtube_accounts").select("business_id", { head: true, count: "exact" }).eq("business_id", businessId).limit(1);
  const setupMissing = Boolean(tableError && missingTable(tableError.code));
  const account = setupMissing ? null : await loadAccount(businessId);
  return {
    platformReady: youTubeMissingSettings(config).length === 0,
    missingSettings: youTubeMissingSettings(config),
    setupMissing,
    connected: Boolean(account),
    channelId: account?.channel_id ?? null,
    channelTitle: account?.channel_title ?? null,
    channelHandle: account?.channel_handle ?? null,
    channelThumbnail: account?.channel_thumbnail ?? null,
    connectedAt: account?.connected_at ?? null,
  };
}

export async function disconnectYouTube(businessId: string, userId: string, fetcher: typeof fetch = fetch) {
  const account = await loadAccount(businessId);
  if (account) {
    // Ask Google to forget the grant too; the row is removed either way.
    try {
      const refresh = decryptMetaToken(account.refresh_token_ciphertext, refreshContext(businessId));
      await call(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }, "revoke", fetcher);
    } catch { /* best effort */ }
  }
  const { error } = await db().from("youtube_accounts").delete().eq("business_id", businessId);
  if (error) throw new Error("Could not disconnect YouTube.");
  await supabaseAdmin.from("audit_events").insert({ business_id: businessId, user_id: userId, event_type: "youtube_disconnected", entity_type: "business", entity_id: businessId, metadata: {} });
}

// ----- Uploading a video -----

const TICKET_TTL_MS = 24 * 60 * 60_000;

/**
 * A signed pass for sending the pieces of one video. It names the business,
 * owner, YouTube's upload address, the post row and the file size, so the
 * upload route can't be pointed anywhere else or used by anyone else.
 */
export function signYouTubeTicket(p: { businessId: string; userId: string; url: string; postId: string; size: number }, now = Date.now()): string {
  return sign("youtube-upload-ticket", { b: p.businessId, u: p.userId, l: p.url, p: p.postId, s: p.size, e: now + TICKET_TTL_MS });
}

export function verifyYouTubeTicket(ticket: string, now = Date.now()): { businessId: string; userId: string; url: string; postId: string; size: number } | null {
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), l: z.string().url(), p: z.string().uuid(), s: z.number().int().positive(), e: z.number() })
    .safeParse(verify("youtube-upload-ticket", ticket));
  if (!parsed.success || parsed.data.e < now || !isYouTubeUploadUrl(parsed.data.l)) return null;
  return { businessId: parsed.data.b, userId: parsed.data.u, url: parsed.data.l, postId: parsed.data.p, size: parsed.data.s };
}

export type YouTubeUploadInput = {
  businessId: string;
  userId: string;
  title: string;
  description: string;
  privacy: YouTubePrivacy;
  /** ISO time; the video is uploaded now as private and YouTube publishes it then. */
  publishAt?: string | null;
  madeForKids: boolean;
  fileSize: number;
  mimeType: string;
  source: "app" | "assistant" | "mcp";
  fetcher?: typeof fetch;
};

/**
 * Step 1: records the video and asks YouTube for a resumable upload address.
 * Nothing is public until every piece has arrived (and, if scheduled, the time comes).
 */
export async function startYouTubeUpload(input: YouTubeUploadInput): Promise<{ postId: string; ticket: string; channelTitle: string }> {
  const title = input.title.trim();
  const description = input.description.trim();
  const problem = videoProblem({ title, description, fileSize: input.fileSize, mimeType: input.mimeType });
  if (problem) throw new Error(problem);
  let publishAt: string | null = null;
  if (input.publishAt) {
    const when = Date.parse(input.publishAt);
    if (Number.isNaN(when)) throw new Error("Pick a date and time to publish.");
    if (when < Date.now() + 15 * 60_000) throw new Error("Pick a time at least 15 minutes from now, or publish straight away.");
    if (when > Date.now() + 365 * 86_400_000) throw new Error("Videos can be scheduled up to a year ahead.");
    publishAt = new Date(when).toISOString();
  }
  const fetcher = input.fetcher ?? fetch;
  const { token, account } = await accessToken(input.businessId, fetcher);

  const { data: row, error: insertError } = await db().from("linkedin_posts").insert({
    business_id: input.businessId,
    platform: "youtube",
    author_urn: `youtube:${account.channel_id}`,
    author_name: account.channel_title,
    body_text: [title, description].filter(Boolean).join("\n\n").slice(0, 6000),
    status: "publishing",
    source: input.source,
    created_by: input.userId,
    scheduled_for: publishAt,
    payload: { title, privacy: publishAt ? "public" : input.privacy, madeForKids: input.madeForKids },
    media: { kind: "video", count: 1, summary: "1 video" },
  }).select("id").single();
  if (insertError || !row) {
    throw new Error(insertError?.code === "23514" || insertError?.code === "42703" || insertError?.code === "PGRST204"
      ? "YouTube posting is waiting for a one-time database update."
      : "Could not save the video.");
  }
  const postId = (row as { id: string }).id;
  const fail = async (message: string) => {
    await db().from("linkedin_posts").update({ status: "failed", error: message.slice(0, 300) }).eq("id", postId);
    return message;
  };

  const res = await call("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(input.fileSize),
      "X-Upload-Content-Type": input.mimeType || "application/octet-stream",
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: "22" },
      status: videoStatus(input.privacy, publishAt, input.madeForKids),
    }),
  }, "upload_start", fetcher);
  const location = res.headers.get("location") ?? "";
  if (!res.ok || !isYouTubeUploadUrl(location)) {
    const reason = res.status === 401 ? "YouTube signed you out. Reconnect YouTube and try again."
      : res.status === 403 ? await quotaOrPermission(res)
      : `YouTube didn't accept the upload (${res.status}).`;
    throw new Error(await fail(reason));
  }
  return {
    postId,
    channelTitle: account.channel_title ?? "your channel",
    ticket: signYouTubeTicket({ businessId: input.businessId, userId: input.userId, url: location, postId, size: input.fileSize }),
  };
}

async function quotaOrPermission(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (/quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/i.test(text)) return "YouTube's daily upload limit has been reached. Try again tomorrow.";
  if (/youtubeSignupRequired/i.test(text)) return "This Google account needs a YouTube channel first.";
  return "YouTube didn't allow this upload. Reconnect YouTube and tick every permission it asks for.";
}

/**
 * Step 2 (the upload route): sends one piece of the video to YouTube with the
 * business's token, which never reaches the browser. The last piece returns
 * the video, which is saved on the post row.
 */
export async function uploadYouTubeChunk(input: { ticket: string; userId: string; start: number; bytes: ArrayBuffer; fetcher?: typeof fetch }):
  Promise<{ done: false; nextByte: number } | { done: true; videoId: string; url: string }> {
  const pass = verifyYouTubeTicket(input.ticket);
  if (!pass || pass.userId !== input.userId) throw new Error("This upload link has expired. Choose the video again.");
  const range = chunkRange(input.start, input.bytes.byteLength, pass.size);
  if (!range) throw new Error("That piece of the video doesn't fit. Choose the video again.");
  const fetcher = input.fetcher ?? fetch;
  const { token } = await accessToken(pass.businessId, fetcher);
  const res = await call(pass.url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Range": range, "Content-Type": "application/octet-stream" },
    body: input.bytes,
  }, "upload_chunk", fetcher, 120_000);
  if (res.status === 308) return { done: false, nextByte: nextByteFrom(res.headers.get("range")) };
  if (res.status === 200 || res.status === 201) {
    const body = z.object({ id: z.string().min(1) }).safeParse(await res.json().catch(() => null));
    if (!body.success) throw new YouTubeError("YouTube's reply wasn't understood.", "upload_done_shape");
    const url = youtubeVideoUrl(body.data.id);
    const { data: post } = await db().from("linkedin_posts").select("scheduled_for").eq("id", pass.postId).maybeSingle();
    const scheduled = Boolean((post as { scheduled_for?: string | null } | null)?.scheduled_for);
    const now = new Date().toISOString();
    await db().from("linkedin_posts").update({
      status: scheduled ? "scheduled" : "published",
      post_urn: body.data.id,
      permalink: url,
      error: null,
      ...(scheduled ? {} : { published_at: now }),
    }).eq("id", pass.postId).eq("business_id", pass.businessId);
    return { done: true, videoId: body.data.id, url };
  }
  if (res.status === 401) throw new Error("YouTube signed you out. Reconnect YouTube and try again.");
  if (res.status === 404 || res.status === 410) {
    await db().from("linkedin_posts").update({ status: "failed", error: "The upload expired." }).eq("id", pass.postId);
    throw new Error("The upload expired. Choose the video again.");
  }
  throw new YouTubeError(`YouTube didn't accept that piece of the video (${res.status}).`, "upload_chunk", res.status);
}

/** The browser gave up (closed, error): mark the row so it doesn't sit at "Uploading". */
export async function abandonYouTubeUpload(businessId: string, postId: string, reason: string) {
  await db().from("linkedin_posts").update({ status: "failed", error: reason.slice(0, 300) })
    .eq("id", postId).eq("business_id", businessId).eq("platform", "youtube").eq("status", "publishing");
}
