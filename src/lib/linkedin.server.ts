import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptMetaToken, encryptMetaToken } from "./meta-oauth.server";
import {
  MEDIA_LIMITS,
  isLinkedInUploadUrl,
  mediaProblem,
  mediaSummary,
  postContentFor,
  type LinkedInMediaKind,
  type LinkedInPostMedia,
} from "./linkedin-media";
import {
  LINKEDIN_CALLBACK_PATH,
  PAGE_SCOPES,
  availableAuthors,
  buildLinkedInAuthorizeUrl,
  buildPostBody,
  daysUntil,
  linkedInPostUrl,
  linkedInScopes,
  organizationUrn,
  personUrn,
  postTextProblem,
  postableOrganizationIds,
  type LinkedInAuthor,
} from "./linkedin";

/**
 * Per-business LinkedIn connection and posting, through LinkedIn's official API.
 * Platform app credentials come from server secrets (LINKEDIN_CLIENT_ID /
 * LINKEDIN_CLIENT_SECRET); each business signs in with its own LinkedIn and only
 * the encrypted access token is kept, bound to that business.
 */

const DEFAULT_API_VERSION = "202610";

// Tables from migration 0035 (not in the generated types until Lovable applies it).
const db = () => supabaseAdmin as unknown as SupabaseClient;

export type LinkedInConfig = {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /**
   * LinkedIn requires Company Page access (Community Management) to be the only
   * product on its app, so Page posting uses a second app with its own keys.
   */
  pagesClientId?: string | undefined;
  pagesClientSecret?: string | undefined;
  pagesEnabled: boolean;
  apiVersion: string;
  appUrl: string;
};

export function readLinkedInConfig(): LinkedInConfig {
  const version = process.env["LINKEDIN_API_VERSION"]?.trim() ?? "";
  return {
    clientId: process.env["LINKEDIN_CLIENT_ID"]?.trim() || undefined,
    clientSecret: process.env["LINKEDIN_CLIENT_SECRET"]?.trim() || undefined,
    pagesClientId: process.env["LINKEDIN_PAGES_CLIENT_ID"]?.trim() || undefined,
    pagesClientSecret: process.env["LINKEDIN_PAGES_CLIENT_SECRET"]?.trim() || undefined,
    pagesEnabled: /^(1|true|yes)$/i.test(process.env["LINKEDIN_PAGES_ENABLED"]?.trim() ?? ""),
    apiVersion: /^\d{6}$/.test(version) ? version : DEFAULT_API_VERSION,
    appUrl: (process.env["PUBLIC_APP_URL"]?.trim() || "https://bookedsecure.com").replace(/\/+$/, ""),
  };
}

/** Names (never values) of the platform settings LinkedIn still needs. */
export function linkedInMissingSettings(config = readLinkedInConfig()): string[] {
  return [
    config.clientId ? null : "LINKEDIN_CLIENT_ID",
    config.clientSecret ? null : "LINKEDIN_CLIENT_SECRET",
    process.env["TENANT_AI_ENCRYPTION_SECRET"] ? null : "TENANT_AI_ENCRYPTION_SECRET",
  ].filter((name): name is string => name !== null);
}

export function linkedInReady(config = readLinkedInConfig()): boolean {
  return Boolean(config.clientId && config.clientSecret && process.env["TENANT_AI_ENCRYPTION_SECRET"]);
}

function assertReady(config: LinkedInConfig) {
  if (!config.clientId || !config.clientSecret) throw new Error("LinkedIn isn't set up on BookedSecure yet (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).");
  if (!process.env["TENANT_AI_ENCRYPTION_SECRET"]) throw new Error("Secure token storage is unavailable.");
}

const tokenContext = (businessId: string) => `linkedin:${businessId}`;
const pagesTokenContext = (businessId: string) => `linkedin-pages:${businessId}`;

/** True when the separate Company Pages app's keys are set. */
export function linkedInPagesAppReady(config = readLinkedInConfig()): boolean {
  return Boolean(config.pagesClientId && config.pagesClientSecret && process.env["TENANT_AI_ENCRYPTION_SECRET"]);
}

// ----- Signed OAuth state: binds the callback to the owner who started it -----

const STATE_TTL_MS = 15 * 60_000;
function stateKey() {
  return createHash("sha256").update(`linkedin-oauth-state:${process.env["TENANT_AI_ENCRYPTION_SECRET"] ?? ""}`).digest();
}

export function signLinkedInState(payload: { businessId: string; userId: string; pages?: boolean }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ b: payload.businessId, u: payload.userId, p: payload.pages ? 1 : 0, e: now + STATE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}

export function verifyLinkedInState(state: string, now = Date.now()): { businessId: string; userId: string; pages: boolean } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: unknown = null;
  try { raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), p: z.number().optional(), e: z.number() }).safeParse(raw);
  if (!parsed.success || parsed.data.e < now) return null;
  return { businessId: parsed.data.b, userId: parsed.data.u, pages: parsed.data.p === 1 };
}

export function linkedInLoginUrl(businessId: string, userId: string, config = readLinkedInConfig()): string {
  assertReady(config);
  return buildLinkedInAuthorizeUrl({
    clientId: config.clientId!,
    redirectUri: `${config.appUrl}${LINKEDIN_CALLBACK_PATH}`,
    state: signLinkedInState({ businessId, userId }),
    scopes: linkedInScopes(config.pagesEnabled),
  });
}

/** Sign-in for Company Pages through the separate Pages app (Community Management). */
export function linkedInPagesLoginUrl(businessId: string, userId: string, config = readLinkedInConfig()): string {
  if (!linkedInPagesAppReady(config)) throw new Error("Company Page posting isn't switched on yet (LINKEDIN_PAGES_CLIENT_ID / LINKEDIN_PAGES_CLIENT_SECRET).");
  return buildLinkedInAuthorizeUrl({
    clientId: config.pagesClientId!,
    redirectUri: `${config.appUrl}${LINKEDIN_CALLBACK_PATH}`,
    state: signLinkedInState({ businessId, userId, pages: true }),
    scopes: [...PAGE_SCOPES],
  });
}

// ----- LinkedIn calls -----

/** A failure tagged with the step and HTTP status; never carries tokens or provider text. */
export class LinkedInError extends Error {
  constructor(message: string, readonly step: string, readonly status?: number) { super(message); }
  get reason(): string { return [this.step, this.status].filter((x) => x !== undefined).join("-"); }
}

async function call(url: string, init: RequestInit, step: string, fetcher: typeof fetch): Promise<Response> {
  try {
    return await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new LinkedInError("LinkedIn could not be reached. Please try again.", `${step}_unreachable`);
  }
}

function restHeaders(token: string, config: LinkedInConfig): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "LinkedIn-Version": config.apiVersion, "X-Restli-Protocol-Version": "2.0.0" };
}

const tokenResponse = z.object({ access_token: z.string().min(10), expires_in: z.number().optional(), scope: z.string().optional() });
const userInfo = z.object({ sub: z.string().min(1), name: z.string().optional() });

async function findPages(token: string, config: LinkedInConfig, fetcher: typeof fetch): Promise<{ id: string; name: string }[]> {
  const res = await call("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=50", { headers: restHeaders(token, config) }, "pages", fetcher);
  if (!res.ok) return [];
  const body = z.object({ elements: z.array(z.object({ organization: z.string().optional(), role: z.string().optional(), state: z.string().optional() })).default([]) }).safeParse(await res.json().catch(() => null));
  if (!body.success) return [];
  const pages: { id: string; name: string }[] = [];
  for (const id of postableOrganizationIds(body.data.elements).slice(0, 10)) {
    const org = await call(`https://api.linkedin.com/rest/organizations/${id}`, { headers: restHeaders(token, config) }, "page", fetcher).catch(() => null);
    const parsed = z.object({ localizedName: z.string().optional() }).safeParse(org?.ok ? await org.json().catch(() => null) : null);
    pages.push({ id, name: (parsed.success && parsed.data.localizedName) || `LinkedIn Page ${id}` });
  }
  return pages;
}

/**
 * Finishes the LinkedIn sign-in. The signed state names the business and owner;
 * ownership is re-checked because the callback carries no BookedSecure session.
 */
export async function completeLinkedInConnect(code: string, state: string, fetcher: typeof fetch = fetch): Promise<"connected"> {
  const who = verifyLinkedInState(state);
  if (!who) throw new Error("This LinkedIn sign-in link has expired. Please connect again.");
  const { requireAppContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireAppContext(supabaseAdmin, who.userId).catch(() => { throw new LinkedInError("Your BookedSecure account could not be checked.", "owner"); });
  try { requireOwner(ctx); } catch { throw new LinkedInError("Only the business owner can connect LinkedIn.", "owner"); }
  if (ctx.businessId !== who.businessId) throw new LinkedInError("This LinkedIn sign-in belongs to a different business.", "owner_business");

  const config = readLinkedInConfig();
  if (who.pages) return completePagesConnect(code, who, config, fetcher);
  assertReady(config);
  const tokenRes = await call("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.appUrl}${LINKEDIN_CALLBACK_PATH}`, client_id: config.clientId!, client_secret: config.clientSecret! }),
  }, "token", fetcher);
  const token = tokenResponse.safeParse(tokenRes.ok ? await tokenRes.json().catch(() => null) : null);
  if (!token.success) throw new LinkedInError("LinkedIn did not accept the sign-in. Please try again.", "token", tokenRes.status);

  const meRes = await call("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token.data.access_token}` } }, "profile", fetcher);
  const me = userInfo.safeParse(meRes.ok ? await meRes.json().catch(() => null) : null);
  if (!me.success) throw new LinkedInError("LinkedIn did not share your profile.", "profile", meRes.status);

  const scopes = (token.data.scope ?? "").split(/[\s,]+/).filter(Boolean);
  const pages = scopes.includes("w_organization_social") ? await findPages(token.data.access_token, config, fetcher) : [];
  const now = new Date();
  const { data: prior } = await db().from("linkedin_accounts").select("default_author_urn").eq("business_id", who.businessId).maybeSingle();
  const authors = new Set([personUrn(me.data.sub), ...pages.map((p) => organizationUrn(p.id))]);
  const keepDefault = prior?.default_author_urn && authors.has(prior.default_author_urn) ? prior.default_author_urn : null;
  const { error } = await db().from("linkedin_accounts").upsert({
    business_id: who.businessId,
    member_urn: personUrn(me.data.sub),
    member_name: me.data.name?.slice(0, 200) ?? null,
    token_ciphertext: encryptMetaToken(token.data.access_token, tokenContext(who.businessId)),
    token_expires_at: token.data.expires_in ? new Date(now.getTime() + token.data.expires_in * 1000).toISOString() : null,
    scopes,
    organizations: pages,
    default_author_urn: keepDefault ?? (pages[0] ? organizationUrn(pages[0].id) : personUrn(me.data.sub)),
    connected_by: who.userId,
    connected_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "business_id" });
  if (error) throw new LinkedInError("Could not save the LinkedIn connection.", "save");
  await supabaseAdmin.from("audit_events").insert({ business_id: who.businessId, user_id: who.userId, event_type: "linkedin_connected", entity_type: "business", entity_id: who.businessId, metadata: { pages: pages.length } });
  return "connected";
}

/**
 * Company Pages through the separate Pages app: keeps that app's token and the
 * Pages the owner can post to on their existing LinkedIn connection.
 */
async function completePagesConnect(
  code: string,
  who: { businessId: string; userId: string },
  config: LinkedInConfig,
  fetcher: typeof fetch,
): Promise<"connected"> {
  if (!linkedInPagesAppReady(config)) throw new LinkedInError("Company Page posting isn't switched on yet.", "pages_config");
  const existing = await loadAccount(who.businessId);
  if (!existing) throw new LinkedInError("Connect your LinkedIn profile first, then your Company Pages.", "pages_profile");
  const tokenRes = await call("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.appUrl}${LINKEDIN_CALLBACK_PATH}`, client_id: config.pagesClientId!, client_secret: config.pagesClientSecret! }),
  }, "pages_token", fetcher);
  const token = tokenResponse.safeParse(tokenRes.ok ? await tokenRes.json().catch(() => null) : null);
  if (!token.success) throw new LinkedInError("LinkedIn did not accept the Company Page sign-in. Please try again.", "pages_token", tokenRes.status);
  const pages = await findPages(token.data.access_token, config, fetcher);
  if (pages.length === 0) throw new LinkedInError("No Company Page you manage was found. You need to be an admin or content admin of the Page.", "pages_none");
  const now = new Date();
  const { error } = await db().from("linkedin_accounts").update({
    organizations: pages,
    pages_token_ciphertext: encryptMetaToken(token.data.access_token, pagesTokenContext(who.businessId)),
    pages_token_expires_at: token.data.expires_in ? new Date(now.getTime() + token.data.expires_in * 1000).toISOString() : null,
    default_author_urn: organizationUrn(pages[0]!.id),
    updated_at: now.toISOString(),
  }).eq("business_id", who.businessId);
  if (error) throw new LinkedInError("Could not save your Company Pages (BookedSecure needs its latest update).", "pages_save");
  await supabaseAdmin.from("audit_events").insert({ business_id: who.businessId, user_id: who.userId, event_type: "linkedin_pages_connected", entity_type: "business", entity_id: who.businessId, metadata: { pages: pages.length } });
  return "connected";
}

// ----- Reading the connection -----

type AccountRow = {
  business_id: string;
  member_urn: string;
  member_name: string | null;
  token_ciphertext: string;
  token_expires_at: string | null;
  scopes: string[];
  organizations: { id: string; name: string }[];
  default_author_urn: string | null;
  connected_at: string;
  /** Token from the separate Company Pages app, when connected (migration 0042). */
  pages_token_ciphertext?: string | null;
  pages_token_expires_at?: string | null;
};

const missingTable = (code?: string) => code === "PGRST205" || code === "42P01";

async function loadAccount(businessId: string): Promise<AccountRow | null> {
  const { data, error } = await db().from("linkedin_accounts")
    .select("business_id, member_urn, member_name, token_ciphertext, token_expires_at, scopes, organizations, default_author_urn, connected_at")
    .eq("business_id", businessId).maybeSingle();
  if (error) {
    if (missingTable(error.code)) return null;
    throw new Error("Could not load the LinkedIn connection.");
  }
  const account = (data as AccountRow | null) ?? null;
  if (!account) return null;
  // Read on their own so LinkedIn keeps working before migration 0042.
  const { data: pages } = await db().from("linkedin_accounts")
    .select("pages_token_ciphertext, pages_token_expires_at")
    .eq("business_id", businessId).maybeSingle();
  return { ...account, ...((pages as Partial<AccountRow> | null) ?? {}) };
}

/** What the owner sees: who is connected and who they can post as. Never the token. */
export async function linkedInStatus(businessId: string) {
  const config = readLinkedInConfig();
  const { error: tableError } = await db().from("linkedin_posts").select("id", { head: true, count: "exact" }).eq("business_id", businessId).limit(1);
  const setupMissing = Boolean(tableError && missingTable(tableError.code));
  const account = setupMissing ? null : await loadAccount(businessId);
  const days = daysUntil(account?.token_expires_at);
  return {
    platformReady: linkedInReady(config),
    missingSettings: linkedInMissingSettings(config),
    pagesEnabled: config.pagesEnabled || linkedInPagesAppReady(config),
    pagesAppReady: linkedInPagesAppReady(config),
    pagesConnected: Boolean(account?.organizations?.length),
    pagesRenewInDays: daysUntil(account?.pages_token_expires_at),
    setupMissing,
    connected: Boolean(account),
    expired: days !== null && days < 0,
    renewInDays: days,
    memberName: account?.member_name ?? null,
    connectedAt: account?.connected_at ?? null,
    authors: account ? availableAuthors(account) : [],
    defaultAuthorUrn: account?.default_author_urn ?? account?.member_urn ?? null,
  };
}

export async function setDefaultLinkedInAuthor(businessId: string, authorUrn: string) {
  const account = await loadAccount(businessId);
  if (!account) throw new Error("Connect LinkedIn first.");
  if (!availableAuthors(account).some((a) => a.urn === authorUrn)) throw new Error("You can't post as that account.");
  const { error } = await db().from("linkedin_accounts").update({ default_author_urn: authorUrn, updated_at: new Date().toISOString() }).eq("business_id", businessId);
  if (error) throw new Error("Could not save that choice.");
}

export async function disconnectLinkedIn(businessId: string, userId: string) {
  const { error } = await db().from("linkedin_accounts").delete().eq("business_id", businessId);
  if (error) throw new Error("Could not disconnect LinkedIn.");
  await supabaseAdmin.from("audit_events").insert({ business_id: businessId, user_id: userId, event_type: "linkedin_disconnected", entity_type: "business", entity_id: businessId, metadata: {} });
}

export type LinkedInPost = {
  id: string;
  authorName: string | null;
  authorUrn: string;
  bodyText: string;
  status: "publishing" | "published" | "failed";
  url: string | null;
  error: string | null;
  source: string;
  createdAt: string;
  publishedAt: string | null;
};

export async function listLinkedInPosts(businessId: string, limit = 30): Promise<LinkedInPost[]> {
  const query = (withPlatform: boolean) => {
    let q = db().from("linkedin_posts")
      .select("id, author_urn, author_name, body_text, status, post_urn, error, source, created_at, published_at")
      .eq("business_id", businessId);
    if (withPlatform) q = q.eq("platform", "linkedin");
    return q.order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  };
  let { data, error } = await query(true);
  // Before docs/social-posts.sql there is no platform column and every row is LinkedIn.
  if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await query(false));
  if (error) {
    if (missingTable(error.code)) return [];
    throw new Error("Could not load your LinkedIn posts.");
  }
  return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
    id: r["id"]!,
    authorName: r["author_name"] ?? null,
    authorUrn: r["author_urn"]!,
    bodyText: r["body_text"] ?? "",
    status: r["status"] as LinkedInPost["status"],
    url: linkedInPostUrl(r["post_urn"]),
    error: r["error"] ?? null,
    source: r["source"] ?? "app",
    createdAt: r["created_at"]!,
    publishedAt: r["published_at"] ?? null,
  }));
}

// ----- Publishing -----

/** The author a post goes out as: the one asked for, else the saved default. */
async function resolveAuthor(account: AccountRow, authorUrn?: string | null): Promise<LinkedInAuthor> {
  const authors = availableAuthors(account);
  const wanted = authorUrn ?? account.default_author_urn ?? account.member_urn;
  const author = authors.find((a) => a.urn === wanted);
  if (!author) throw new Error("You can't post as that LinkedIn account. Reconnect LinkedIn if your Page is missing.");
  return author;
}

/** Who a post will go out as, for previews (Assistant, ChatGPT). */
export async function linkedInPreviewAuthor(businessId: string, authorUrn?: string | null): Promise<LinkedInAuthor> {
  const account = await loadAccount(businessId);
  if (!account) throw new Error("LinkedIn isn't connected. Connect it under LinkedIn in BookedSecure first.");
  return resolveAuthor(account, authorUrn);
}

function friendlyPublishError(status: number, body: string): string {
  if (status === 401) return "LinkedIn signed you out. Reconnect LinkedIn and try again.";
  if (status === 403) return "LinkedIn didn't allow this post. Make sure you're an admin of that Page, or reconnect LinkedIn.";
  if (status === 422 && /duplicate/i.test(body)) return "LinkedIn says this post is a duplicate of a recent one.";
  if (status === 429) return "LinkedIn's posting limit was reached. Try again later.";
  return `LinkedIn didn't accept the post (${status}).`;
}

/**
 * Publishes a public text post as the owner's profile or a Page they manage.
 * The post row is written first, so a slow or failed call is still recorded,
 * and the same text to the same author within two minutes isn't posted twice.
 */
export async function publishLinkedInPost(input: {
  businessId: string;
  userId: string;
  text: string;
  authorUrn?: string | null;
  source: "app" | "assistant" | "mcp";
  /** Images, a video or a document already uploaded to LinkedIn. */
  media?: LinkedInPostMedia | null;
  fetcher?: typeof fetch;
}): Promise<{ published: true; duplicate?: boolean; postId: string; url: string | null; authorName: string }> {
  const problem = postTextProblem(input.text);
  if (problem) throw new Error(problem);
  const badMedia = mediaProblem(input.media);
  if (badMedia) throw new Error(badMedia);
  const text = input.text.trim();
  const config = readLinkedInConfig();
  assertReady(config);
  const account = await loadAccount(input.businessId);
  if (!account) throw new Error("LinkedIn isn't connected. Connect it under LinkedIn first.");
  const days = daysUntil(account.token_expires_at);
  if (days !== null && days < 0) throw new Error("Your LinkedIn connection has expired. Reconnect LinkedIn to post.");
  const author = await resolveAuthor(account, input.authorUrn);

  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: recent } = await db().from("linkedin_posts").select("id, status, post_urn")
    .eq("business_id", input.businessId).eq("author_urn", author.urn).eq("body_text", text).neq("status", "failed").gte("created_at", since).limit(1);
  const dup = (recent as { id: string; post_urn: string | null }[] | null)?.[0];
  if (dup) return { published: true, duplicate: true, postId: dup.id, url: linkedInPostUrl(dup.post_urn), authorName: author.name };

  const baseRow = {
    business_id: input.businessId, author_urn: author.urn, author_name: author.name, body_text: text, status: "publishing", source: input.source, created_by: input.userId,
  };
  let { data: row, error: insertError } = await db().from("linkedin_posts")
    .insert({ ...baseRow, ...(input.media ? { media: { ...input.media, summary: mediaSummary(input.media) } } : {}) }).select("id").single();
  // Before migration 0043 there is no media column: keep the post, just not its media note.
  if (insertError && input.media && (insertError.code === "PGRST204" || insertError.code === "42703")) {
    ({ data: row, error: insertError } = await db().from("linkedin_posts").insert(baseRow).select("id").single());
  }
  if (insertError || !row) throw new Error(missingTable(insertError?.code) ? "LinkedIn posting is waiting for a database update (migration 0035)." : "Could not save the post.");
  const postId = (row as { id: string }).id;

  // Page posts go through the Company Pages app's token when that app is used.
  const usePagesToken = author.kind === "organization" && Boolean(account.pages_token_ciphertext);
  if (usePagesToken) {
    const pageDays = daysUntil(account.pages_token_expires_at);
    if (pageDays !== null && pageDays < 0) throw new Error("Your Company Page connection has expired. Reconnect your Company Pages to post.");
  }
  const token = usePagesToken
    ? decryptMetaToken(account.pages_token_ciphertext!, pagesTokenContext(input.businessId))
    : decryptMetaToken(account.token_ciphertext, tokenContext(input.businessId));
  let failure: string | null = null;
  let postUrn: string | null = null;
  try {
    // A video or document must finish processing on LinkedIn before it can be posted.
    if (input.media && input.media.kind !== "image") {
      await waitUntilReady(input.media.kind, input.media.urn, token, config, input.fetcher ?? fetch);
    }
    const res = await call("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: { ...restHeaders(token, config), "Content-Type": "application/json" },
      body: JSON.stringify(buildPostBody(author.urn, text, postContentFor(input.media))),
    }, "publish", input.fetcher ?? fetch);
    if (res.status === 201 || res.ok) postUrn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    else failure = friendlyPublishError(res.status, await res.text().catch(() => ""));
  } catch (e) {
    failure = e instanceof Error ? e.message : "LinkedIn could not be reached.";
  }
  const now = new Date().toISOString();
  await db().from("linkedin_posts").update(failure
    ? { status: "failed", error: failure.slice(0, 300) }
    : { status: "published", post_urn: postUrn, published_at: now }).eq("id", postId);
  if (failure) throw new Error(failure);
  await supabaseAdmin.from("audit_events").insert({ business_id: input.businessId, user_id: input.userId, event_type: "linkedin_post_published", entity_type: "business", entity_id: input.businessId, metadata: { post_id: postId, source: input.source, author: author.kind } });
  return { published: true, postId, url: linkedInPostUrl(postUrn), authorName: author.name };
}

// ----- Images, videos and documents -----

/** The LinkedIn token that may act for this author (Page posts use the Pages app's token when connected). */
async function tokenForAuthor(businessId: string, authorUrn?: string | null) {
  const config = readLinkedInConfig();
  assertReady(config);
  const account = await loadAccount(businessId);
  if (!account) throw new Error("LinkedIn isn't connected. Connect it under LinkedIn first.");
  const author = await resolveAuthor(account, authorUrn);
  const usePages = author.kind === "organization" && Boolean(account.pages_token_ciphertext);
  const token = usePages
    ? decryptMetaToken(account.pages_token_ciphertext!, pagesTokenContext(businessId))
    : decryptMetaToken(account.token_ciphertext, tokenContext(businessId));
  return { config, author, token };
}

const TICKET_TTL_MS = 2 * 60 * 60_000;
function ticketKey() {
  return createHash("sha256").update(`linkedin-upload-ticket:${process.env["TENANT_AI_ENCRYPTION_SECRET"] ?? ""}`).digest();
}

/**
 * A signed pass for uploading one piece of a file. It names the business, the
 * owner, the LinkedIn upload address and the author, so the upload route can't
 * be pointed anywhere else or used by anyone else.
 */
export function signUploadTicket(payload: { businessId: string; userId: string; url: string; authorUrn: string }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ b: payload.businessId, u: payload.userId, l: payload.url, a: payload.authorUrn, e: now + TICKET_TTL_MS })).toString("base64url");
  return `${body}.${createHmac("sha256", ticketKey()).update(body).digest("base64url")}`;
}

export function verifyUploadTicket(ticket: string, now = Date.now()): { businessId: string; userId: string; url: string; authorUrn: string } | null {
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", ticketKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: unknown = null;
  try { raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), l: z.string().url(), a: z.string(), e: z.number() }).safeParse(raw);
  if (!parsed.success || parsed.data.e < now || !isLinkedInUploadUrl(parsed.data.l)) return null;
  return { businessId: parsed.data.b, userId: parsed.data.u, url: parsed.data.l, authorUrn: parsed.data.a };
}

export type UploadPlan = {
  kind: LinkedInMediaKind;
  urn: string;
  /** Each piece of the file to send to /api/linkedin/upload with its ticket. */
  parts: { ticket: string; firstByte: number; lastByte: number }[];
  /** Needed to finish a video upload. */
  uploadToken: string | null;
};

const ENDPOINT: Record<LinkedInMediaKind, string> = { image: "images", video: "videos", document: "documents" };

/** Step 1: asks LinkedIn where to upload a file. Nothing is posted. */
export async function startLinkedInUpload(input: {
  businessId: string;
  userId: string;
  kind: LinkedInMediaKind;
  fileSize: number;
  authorUrn?: string | null;
  fetcher?: typeof fetch;
}): Promise<UploadPlan> {
  const limits = MEDIA_LIMITS[input.kind];
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0 || input.fileSize > limits.maxBytes) {
    throw new Error(`That ${input.kind} is too big for LinkedIn (limit ${Math.round(limits.maxBytes / 1024 / 1024)}MB).`);
  }
  const { config, author, token } = await tokenForAuthor(input.businessId, input.authorUrn);
  const fetcher = input.fetcher ?? fetch;
  const request = input.kind === "video"
    ? { owner: author.urn, fileSizeBytes: input.fileSize, uploadCaptions: false, uploadThumbnail: false }
    : { owner: author.urn };
  const res = await call(`https://api.linkedin.com/rest/${ENDPOINT[input.kind]}?action=initializeUpload`, {
    method: "POST",
    headers: { ...restHeaders(token, config), "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: request }),
  }, `upload_${input.kind}`, fetcher);
  if (res.status === 401) throw new Error("LinkedIn signed you out. Reconnect LinkedIn and try again.");
  if (!res.ok) throw new LinkedInError(`LinkedIn didn't accept the ${input.kind} upload (${res.status}).`, `upload_${input.kind}`, res.status);
  const body = z.object({
    value: z.object({
      uploadUrl: z.string().optional(),
      image: z.string().optional(),
      video: z.string().optional(),
      document: z.string().optional(),
      uploadToken: z.string().optional(),
      uploadInstructions: z.array(z.object({ uploadUrl: z.string(), firstByte: z.number(), lastByte: z.number() })).optional(),
    }),
  }).safeParse(await res.json().catch(() => null));
  if (!body.success) throw new LinkedInError(`LinkedIn's ${input.kind} upload reply wasn't understood.`, `upload_${input.kind}_shape`);
  const v = body.data.value;
  const urn = v.image ?? v.video ?? v.document;
  const pieces = input.kind === "video"
    ? (v.uploadInstructions ?? [])
    : v.uploadUrl ? [{ uploadUrl: v.uploadUrl, firstByte: 0, lastByte: input.fileSize - 1 }] : [];
  if (!urn || pieces.length === 0 || pieces.some((p) => !isLinkedInUploadUrl(p.uploadUrl))) {
    throw new LinkedInError(`LinkedIn didn't give an upload address for the ${input.kind}.`, `upload_${input.kind}_url`);
  }
  return {
    kind: input.kind,
    urn,
    uploadToken: v.uploadToken ?? null,
    parts: pieces.map((p) => ({
      ticket: signUploadTicket({ businessId: input.businessId, userId: input.userId, url: p.uploadUrl, authorUrn: author.urn }),
      firstByte: p.firstByte,
      lastByte: p.lastByte,
    })),
  };
}

/**
 * Step 2 (the upload route): sends one piece of the file to LinkedIn with the
 * business's token, which never reaches the browser. Returns LinkedIn's ETag,
 * which a video needs to finish.
 */
export async function uploadLinkedInPart(input: { ticket: string; userId: string; bytes: ArrayBuffer; fetcher?: typeof fetch }): Promise<{ etag: string | null }> {
  const pass = verifyUploadTicket(input.ticket);
  if (!pass || pass.userId !== input.userId) throw new Error("This upload link has expired. Try attaching the file again.");
  if (input.bytes.byteLength === 0) throw new Error("The file piece was empty.");
  const { token } = await tokenForAuthor(pass.businessId, pass.authorUrn);
  const res = await call(pass.url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: input.bytes,
  }, "upload_part", input.fetcher ?? fetch);
  if (res.status === 401) throw new Error("LinkedIn signed you out. Reconnect LinkedIn and try again.");
  if (!res.ok) throw new LinkedInError(`LinkedIn didn't accept the file (${res.status}).`, "upload_part", res.status);
  return { etag: res.headers.get("etag") };
}

/** Step 3 (videos only): tells LinkedIn every piece has arrived. */
export async function finishLinkedInVideoUpload(input: {
  businessId: string;
  urn: string;
  uploadToken: string | null;
  etags: string[];
  authorUrn?: string | null;
  fetcher?: typeof fetch;
}): Promise<{ ok: true }> {
  if (!/^urn:li:video:[\w-]+$/.test(input.urn)) throw new Error("That isn't a LinkedIn video.");
  const { config, token } = await tokenForAuthor(input.businessId, input.authorUrn);
  const res = await call("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: { ...restHeaders(token, config), "Content-Type": "application/json" },
    body: JSON.stringify({ finalizeUploadRequest: { video: input.urn, uploadToken: input.uploadToken ?? "", uploadedPartIds: input.etags } }),
  }, "upload_video_finish", input.fetcher ?? fetch);
  if (!res.ok) throw new LinkedInError(`LinkedIn couldn't finish the video upload (${res.status}).`, "upload_video_finish", res.status);
  return { ok: true };
}

/** Waits (up to ~50 seconds) for LinkedIn to finish processing a video or document. */
async function waitUntilReady(kind: "video" | "document", urn: string, token: string, config: LinkedInConfig, fetcher: typeof fetch) {
  const path = kind === "video" ? "videos" : "documents";
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await call(`https://api.linkedin.com/rest/${path}/${encodeURIComponent(urn)}`, { headers: restHeaders(token, config) }, `${kind}_status`, fetcher);
    const body = z.object({ status: z.string().optional() }).safeParse(res.ok ? await res.json().catch(() => null) : null);
    const status = body.success ? body.data.status : undefined;
    if (status === "AVAILABLE") return;
    if (status === "PROCESSING_FAILED") throw new Error(`LinkedIn couldn't process the ${kind}. Try a different file.`);
    if (!res.ok && res.status !== 404) return; // Let the post call report anything unexpected.
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`LinkedIn is still processing the ${kind}. Wait a minute and press Post again.`);
}

// ----- AI writing -----

/** AI writes a LinkedIn post from the owner's brief. Nothing is posted or saved. */
export type PostPlatform = "linkedin" | "facebook" | "instagram";
const PLATFORM_STYLE: Record<PostPlatform | "youtube", { name: string; style: string }> = {
  youtube: { name: "YouTube", style: "Write a YouTube video title and description. The first line is only the title: under 80 characters, clear and searchable, no quotes, no hashtags. Then one blank line, then a description of 60 to 200 words: what the video shows, who it helps and the area served, short paragraphs, plain text, Australian English. Never use < or >." },
  linkedin: { name: "LinkedIn", style: "Write one post of 60 to 180 words: a strong first line, short paragraphs, plain text, Australian English, warm and professional." },
  facebook: { name: "Facebook", style: "Write one Facebook Page post of 40 to 120 words: friendly and local, a clear first line, short paragraphs, plain text, Australian English." },
  instagram: { name: "Instagram", style: "Write one Instagram caption of 30 to 100 words: a hook in the first line, short lines, plain text, Australian English. Put up to six relevant hashtags on the last line." },
};

export async function draftLinkedInPost(input: { businessId: string; brief: string; chips?: string[]; platform?: PostPlatform | "youtube" }): Promise<{ text: string }> {
  const platform = PLATFORM_STYLE[input.platform ?? "linkedin"];
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("The AI service is not configured.");
  const { checkAiCap, recordAiUsage } = await import("./usage.server");
  if ((await checkAiCap(input.businessId)).blocked) throw new Error("This month's AI limit is reached.");
  const { loadBusinessFacts, FACTS_ONLY_RULES } = await import("./business-facts.server");
  const facts = await loadBusinessFacts(input.businessId);
  const { generateText, streamText } = await import("ai");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const { withAiBackup } = await import("./tenant-ai.server");
  const { ANALYSIS_MODEL } = await import("./ai.server");
  const system = [
    `You write ${platform.name} posts for ${facts.name}.`,
    FACTS_ONLY_RULES,
    platform.style,
    "End with a simple call to action. Add at most three relevant hashtags on the last line.",
    "Never invent prices, discounts, dates, results, awards or customer names the owner did not give. No placeholders or brackets. No emojis unless asked.",
    "Only use a suggested angle (for example a seasonal reminder) if it fits what this business actually does.",
    "",
    "Business facts:",
    ...facts.lines,
    "Reply with only the post.",
  ].join("\n");
  const prompt = [
    input.brief.trim() ? `Owner's brief: """${input.brief.trim().slice(0, 2000)}"""` : "Write a post introducing the business and what it does.",
    input.chips?.length ? `Also: ${input.chips.slice(0, 8).join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");
  const gateway = createOpenAICompatible({ name: "lovable", baseURL: "https://ai.gateway.lovable.dev/v1", headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const result = await withAiBackup({
    businessId: input.businessId,
    role: "fast",
    usage: { source: "lovable" },
    gateway: async () => {
      const r = await generateText({ model: gateway(ANALYSIS_MODEL), system, prompt });
      return { text: r.text, input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 };
    },
    backup: async (provider) => {
      const r = streamText({ ...provider, maxRetries: 0, system, prompt, onError: () => undefined });
      const u = await r.usage;
      return { text: await r.text, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 };
    },
  });
  await recordAiUsage({ businessId: input.businessId, purpose: `${input.platform ?? "linkedin"}_post_draft`, model: ANALYSIS_MODEL, inputTokens: result.input, outputTokens: result.output }).catch(() => undefined);
  const text = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 3000);
  if (!text) throw new Error("The AI didn't return a post. Please try again.");
  return { text };
}

// ----- Confirmation codes (Assistant and ChatGPT must show the post and get a yes first) -----

function confirmSecret(): string {
  return process.env["EMAIL_SEND_CONFIRM_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["LOVABLE_API_KEY"] ?? "bookedsecure";
}

/** A short hash of exactly what will be posted and as whom; any change needs a new preview. */
export function linkedInConfirmationCode(businessId: string, authorUrn: string, text: string): string {
  return createHash("sha256").update(`${confirmSecret()}|linkedin|${businessId}|${authorUrn}|${text.trim()}`).digest("hex").slice(0, 8).toUpperCase();
}

export const linkedInActions = {
  async status(businessId: string) {
    const { metaPostingStatus } = await import("./meta-publish.server");
    const [linkedin, meta] = await Promise.all([linkedInStatus(businessId), metaPostingStatus(businessId)]);
    return { ...linkedin, facebook: { connected: meta.connected, page: meta.pageName }, instagram: { connected: Boolean(meta.instagram), account: meta.instagram?.username ?? null } };
  },
  async posts(businessId: string, limit?: number, platform: PostPlatform = "linkedin") {
    if (platform === "linkedin") return listLinkedInPosts(businessId, limit);
    const { listMetaPosts } = await import("./meta-publish.server");
    return listMetaPosts(businessId, platform, limit);
  },
  write: (businessId: string, brief: string, platform: PostPlatform = "linkedin") => draftLinkedInPost({ businessId, brief, platform }),
  async preview(businessId: string, input: { text: string; authorUrn?: string | null; platform?: PostPlatform; imagePaths?: string[] }) {
    if (input.platform && input.platform !== "linkedin") {
      const { metaPostProblem, metaPostingStatus, metaConfirmationCode } = await import("./meta-publish.server");
      const images = input.imagePaths ?? [];
      const problem = metaPostProblem(input.platform, input.text, images.length);
      if (problem) throw new Error(problem);
      const meta = await metaPostingStatus(businessId);
      if (!meta.connected) throw new Error("Facebook isn't connected. Connect it under Connections in BookedSecure first.");
      if (input.platform === "instagram" && !meta.instagram) throw new Error("No Instagram account is linked to the connected Facebook Page.");
      return {
        confirmationCode: metaConfirmationCode(businessId, input.platform, input.text, images),
        summary: { platform: input.platform, postsAs: input.platform === "instagram" ? `@${meta.instagram?.username ?? "instagram"}` : meta.pageName, text: input.text.trim(), pictures: images.length, visibility: "Public" },
        instructions: "Show the owner exactly this post and where it goes, and ask them to confirm. Only after a clear yes, call publish with the same platform, text, imagePaths and this confirmationCode.",
      };
    }
    const problem = postTextProblem(input.text);
    if (problem) throw new Error(problem);
    const author = await linkedInPreviewAuthor(businessId, input.authorUrn);
    return {
      confirmationCode: linkedInConfirmationCode(businessId, author.urn, input.text),
      summary: { postsAs: author.name, kind: author.kind === "organization" ? "Company Page" : "Personal profile", text: input.text.trim(), visibility: "Public" },
      authorUrn: author.urn,
      instructions: "Show the owner exactly this post and who it posts as, and ask them to confirm. Only after a clear yes, call publish with the same text, authorUrn and this confirmationCode.",
    };
  },
  async publish(businessId: string, userId: string, input: { text: string; authorUrn?: string | null; confirmationCode: string; source: "assistant" | "mcp"; platform?: PostPlatform; imagePaths?: string[] }) {
    if (input.platform && input.platform !== "linkedin") {
      const { metaConfirmationCode, publishMetaPost } = await import("./meta-publish.server");
      const images = input.imagePaths ?? [];
      if (input.confirmationCode.trim().toUpperCase() !== metaConfirmationCode(businessId, input.platform, input.text, images)) {
        throw new Error("That confirmation doesn't match this post. Preview it again and ask the owner to confirm.");
      }
      return publishMetaPost({ businessId, userId, platform: input.platform, text: input.text, imagePaths: images, source: input.source });
    }
    const author = await linkedInPreviewAuthor(businessId, input.authorUrn);
    if (input.confirmationCode.trim().toUpperCase() !== linkedInConfirmationCode(businessId, author.urn, input.text)) {
      throw new Error("That confirmation doesn't match this post. Preview it again and ask the owner to confirm.");
    }
    return publishLinkedInPost({ businessId, userId, text: input.text, authorUrn: author.urn, source: input.source });
  },
};
