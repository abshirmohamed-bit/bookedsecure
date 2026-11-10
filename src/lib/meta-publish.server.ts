/**
 * Facebook Page and Instagram posting with the business's own connected Page
 * (meta_lead_accounts, the same encrypted connection as lead import and the
 * comments/DM inbox). Posts are recorded in linkedin_posts with a platform, so
 * every network shares one history. Nothing is posted without an owner action
 * (the Post button, or an assistant's preview confirmed by the owner).
 *
 * Pictures: the browser turns each one into a JPEG (Instagram accepts JPEG
 * only) and uploads it to BookedSecure storage; at publish time Meta fetches it
 * through a short-lived signed address.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { describeGraphFailure, loadMetaAccount, type DirectMetaAccount } from "./meta-direct.server";
import { readMetaAppConfig } from "./meta-oauth.server";
import { TENANT_LOGO_BUCKET } from "./tenant-logo";

export type MetaPlatform = "facebook" | "instagram";
export const FACEBOOK_POST_MAX = 5000;
export const INSTAGRAM_CAPTION_MAX = 2200;
export const MAX_POST_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

/** What's wrong with a post before anything is sent, or null. */
export function metaPostProblem(platform: MetaPlatform, text: string, imageCount: number): string | null {
  const trimmed = text.trim();
  if (imageCount > MAX_POST_IMAGES) return `Add up to ${MAX_POST_IMAGES} pictures.`;
  if (platform === "instagram") {
    if (imageCount === 0) return "Instagram posts need at least one picture.";
    if (trimmed.length > INSTAGRAM_CAPTION_MAX) return `Instagram captions can be up to ${INSTAGRAM_CAPTION_MAX} characters.`;
    return null;
  }
  if (!trimmed && imageCount === 0) return "Write something or add a picture.";
  if (trimmed.length > FACEBOOK_POST_MAX) return `Facebook posts can be up to ${FACEBOOK_POST_MAX} characters.`;
  return null;
}

function graph(account: DirectMetaAccount, fetcher: typeof fetch) {
  const version = readMetaAppConfig().version;
  return async function call(method: "GET" | "POST", path: string, params: Record<string, string> = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    const body = new URLSearchParams(params);
    if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetcher(url, {
        method,
        headers: { Authorization: `Bearer ${account.token}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(method === "POST" ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Facebook could not be reached. Please try again.");
    }
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || (json && typeof json === "object" && "error" in json)) throw new Error(friendlyMetaError(res.status, json));
    return (json ?? {}) as Record<string, unknown>;
  };
}

function friendlyMetaError(status: number, body: unknown): string {
  const error = (body as { error?: { code?: number; message?: string } } | null)?.error;
  const meta = error?.message ? ` Facebook said: "${error.message.slice(0, 200)}"` : "";
  if (error?.code === 200 || error?.code === 10 || status === 403) {
    return `Facebook didn't allow this post: the connection is missing posting permission. Reconnect Facebook in Connections and approve posting to your Page and Instagram.${meta}`;
  }
  return `${describeGraphFailure(status, body)}${meta}`;
}

/** The Instagram professional account linked to the connected Page, if any. */
export async function linkedInstagram(account: DirectMetaAccount, fetcher: typeof fetch = fetch): Promise<{ id: string; username: string | null } | null> {
  const r = await graph(account, fetcher)("GET", account.pageId, { fields: "instagram_business_account{id,username}" });
  const ig = (r["instagram_business_account"] ?? null) as { id?: string; username?: string } | null;
  return ig?.id ? { id: ig.id, username: ig.username ?? null } : null;
}

/** Who the business can post as on Facebook and Instagram. */
export async function metaPostingStatus(businessId: string) {
  let account: DirectMetaAccount;
  try {
    account = await loadMetaAccount(businessId);
  } catch {
    return { connected: false as const, pageName: null, instagram: null };
  }
  let instagram: { id: string; username: string | null } | null = null;
  try { instagram = await linkedInstagram(account); } catch { instagram = null; }
  return { connected: true as const, pageName: account.pageName, instagram: instagram ? { username: instagram.username } : null };
}

// ----- Pictures -----

function ownImagePath(businessId: string, path: string): boolean {
  return new RegExp(`^${businessId}/social-[0-9a-f-]{36}\\.jpg$`).test(path);
}

/** Stores one JPEG picture for a post. Returns its storage path. */
export async function storeSocialImage(businessId: string, dataBase64: string): Promise<{ path: string }> {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(Buffer.from(dataBase64, "base64")); } catch { throw new Error("That picture could not be read."); }
  if (bytes.byteLength < 100 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Pictures must be under 8 MB.");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error("Pictures must be JPEG.");
  const path = `${businessId}/social-${crypto.randomUUID()}.jpg`;
  const { error } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("The picture could not be uploaded.");
  return { path };
}

async function signedImageUrls(businessId: string, paths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const path of paths) {
    if (!ownImagePath(businessId, path)) throw new Error("One of the pictures isn't from this business.");
    const { data, error } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) throw new Error("A picture could not be prepared for posting.");
    urls.push(data.signedUrl);
  }
  return urls;
}

// ----- Publishing -----

async function waitForInstagramContainer(call: ReturnType<typeof graph>, containerId: string) {
  for (let i = 0; i < 10; i += 1) {
    const r = await call("GET", containerId, { fields: "status_code" });
    const status = r["status_code"];
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error("Instagram couldn't process a picture. Try a different one.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Instagram is still processing the pictures. Try Post again in a minute.");
}

/**
 * Publishes now. The post row is written first so a slow or failed call is still
 * recorded, and the same post within two minutes isn't sent twice.
 */
export async function publishMetaPost(input: {
  businessId: string;
  userId: string;
  platform: MetaPlatform;
  text: string;
  imagePaths?: string[];
  source: "app" | "assistant" | "mcp";
  fetcher?: typeof fetch;
}): Promise<{ published: true; duplicate?: boolean; postId: string; url: string | null; postsAs: string }> {
  const text = input.text.trim();
  const imagePaths = input.imagePaths ?? [];
  const problem = metaPostProblem(input.platform, text, imagePaths.length);
  if (problem) throw new Error(problem);
  const account = await loadMetaAccount(input.businessId);
  const fetcher = input.fetcher ?? fetch;
  const call = graph(account, fetcher);
  const ig = input.platform === "instagram" ? await linkedInstagram(account, fetcher) : null;
  if (input.platform === "instagram" && !ig) {
    throw new Error("No Instagram account is linked to your Facebook Page. Link a professional Instagram account to the Page in Meta, then reconnect Facebook.");
  }
  const authorUrn = input.platform === "instagram" ? `instagram:${ig!.id}` : `facebook:${account.pageId}`;
  const postsAs = input.platform === "instagram" ? `@${ig!.username ?? "instagram"}` : account.pageName ?? "your Facebook Page";
  const bodyText = text || "(picture post)";

  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: recent } = await db().from("linkedin_posts").select("id, permalink")
    .eq("business_id", input.businessId).eq("author_urn", authorUrn).eq("body_text", bodyText).neq("status", "failed").gte("created_at", since).limit(1);
  const dup = (recent as { id: string; permalink: string | null }[] | null)?.[0];
  if (dup) return { published: true, duplicate: true, postId: dup.id, url: dup.permalink, postsAs };

  const { data: row, error: insertError } = await db().from("linkedin_posts").insert({
    business_id: input.businessId, platform: input.platform, author_urn: authorUrn, author_name: postsAs, body_text: bodyText,
    status: "publishing", source: input.source, created_by: input.userId,
    ...(imagePaths.length ? { media: { kind: "image", count: imagePaths.length, summary: `${imagePaths.length} picture${imagePaths.length === 1 ? "" : "s"}` } } : {}),
  }).select("id").single();
  if (insertError || !row) {
    throw new Error(insertError?.code === "42703" || insertError?.code === "PGRST204"
      ? "Facebook and Instagram posting is waiting for a one-time database update."
      : "Could not save the post.");
  }
  const postId = (row as { id: string }).id;

  let failure: string | null = null;
  let externalId: string | null = null;
  let permalink: string | null = null;
  try {
    const urls = await signedImageUrls(input.businessId, imagePaths);
    if (input.platform === "facebook") {
      if (urls.length === 0) {
        externalId = (await call("POST", `${account.pageId}/feed`, { message: text }))["id"] as string;
      } else if (urls.length === 1) {
        const r = await call("POST", `${account.pageId}/photos`, { url: urls[0]!, ...(text ? { caption: text } : {}) });
        externalId = ((r["post_id"] ?? r["id"]) as string) ?? null;
      } else {
        const ids: string[] = [];
        for (const url of urls) ids.push((await call("POST", `${account.pageId}/photos`, { url, published: "false" }))["id"] as string);
        externalId = (await call("POST", `${account.pageId}/feed`, {
          ...(text ? { message: text } : {}),
          attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
        }))["id"] as string;
      }
      if (externalId) permalink = ((await call("GET", externalId, { fields: "permalink_url" }).catch(() => ({} as Record<string, unknown>)))["permalink_url"] as string | undefined) ?? null;
    } else {
      let containerId: string;
      if (urls.length === 1) {
        containerId = (await call("POST", `${ig!.id}/media`, { image_url: urls[0]!, ...(text ? { caption: text } : {}) }))["id"] as string;
      } else {
        const children: string[] = [];
        for (const url of urls) children.push((await call("POST", `${ig!.id}/media`, { image_url: url, is_carousel_item: "true" }))["id"] as string);
        containerId = (await call("POST", `${ig!.id}/media`, { media_type: "CAROUSEL", children: children.join(","), ...(text ? { caption: text } : {}) }))["id"] as string;
      }
      await waitForInstagramContainer(call, containerId);
      externalId = (await call("POST", `${ig!.id}/media_publish`, { creation_id: containerId }))["id"] as string;
      if (externalId) permalink = ((await call("GET", externalId, { fields: "permalink" }).catch(() => ({} as Record<string, unknown>)))["permalink"] as string | undefined) ?? null;
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : "Facebook could not be reached.";
  }

  const now = new Date().toISOString();
  await db().from("linkedin_posts").update(failure
    ? { status: "failed", error: failure.slice(0, 300) }
    : { status: "published", post_urn: externalId, permalink, published_at: now }).eq("id", postId);
  if (failure) throw new Error(failure);
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId, user_id: input.userId, event_type: `${input.platform}_post_published`, entity_type: "business",
    entity_id: input.businessId, metadata: { post_id: postId, source: input.source, pictures: imagePaths.length },
  });
  return { published: true, postId, url: permalink, postsAs };
}

export type SocialPost = {
  id: string;
  platform: "linkedin" | MetaPlatform;
  postsAs: string | null;
  bodyText: string;
  status: "publishing" | "published" | "failed";
  url: string | null;
  error: string | null;
  createdAt: string;
};

/** Recent Facebook or Instagram posts made from BookedSecure. */
export async function listMetaPosts(businessId: string, platform: MetaPlatform, limit = 30): Promise<SocialPost[]> {
  const { data, error } = await db().from("linkedin_posts")
    .select("id, platform, author_name, body_text, status, permalink, error, created_at")
    .eq("business_id", businessId).eq("platform", platform).order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) return [];
  return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
    id: r["id"]!,
    platform,
    postsAs: r["author_name"] ?? null,
    bodyText: r["body_text"] ?? "",
    status: r["status"] as SocialPost["status"],
    url: r["permalink"] ?? null,
    error: r["error"] ?? null,
    createdAt: r["created_at"]!,
  }));
}

// ----- Assistant confirmation (same contract as LinkedIn) -----

function confirmSecret(): string {
  return process.env["EMAIL_SEND_CONFIRM_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["LOVABLE_API_KEY"] ?? "bookedsecure";
}

/** A short hash of exactly what will be posted where; any change needs a new preview. */
export function metaConfirmationCode(businessId: string, platform: MetaPlatform, text: string, imagePaths: string[]): string {
  return createHash("sha256").update(`${confirmSecret()}|${platform}|${businessId}|${text.trim()}|${imagePaths.join(",")}`).digest("hex").slice(0, 8).toUpperCase();
}
