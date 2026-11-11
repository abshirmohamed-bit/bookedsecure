/**
 * The social planner: drafts, approval before publishing, the calendar, and
 * post performance, on the one posts table (linkedin_posts, platform column).
 *
 * Writing a draft or submitting it for approval never reaches Facebook or
 * Instagram. Only approvePost does, and only for the owner: it publishes now
 * through publishMetaPost, or marks the post scheduled for its planned time,
 * where processDueScheduledPosts publishes it as before. Until migration 0063
 * is applied the new statuses are refused by the database and every function
 * says so; posting and scheduling carry on unchanged.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMetaAccount } from "./meta-direct.server";
import { graph, metaAuthor, metaPostProblem, type MetaPlatform, ownImagePath, publishMetaPost } from "./meta-publish.server";
import { facebookInsights, instagramInsights, plannerAt, type PlannerPost, type PlannerStatus, type PostInsights } from "./social-planner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;
const NOT_READY = "Drafts and approval are waiting for a one-time database update (migration 0063).";
const MIN_LEAD_MS = 5 * 60_000;
const MAX_AHEAD_MS = 60 * 24 * 60 * 60_000;
const INSIGHTS_EVERY_MS = 6 * 3600_000;
const INSIGHTS_FOR_DAYS = 30;

const notReady = (code?: string) => code === "23514" || code === "42703" || code === "PGRST204";

type Row = {
  id: string; platform: string; status: PlannerStatus; author_name: string | null; body_text: string; payload: { text?: string; imagePaths?: string[] } | null;
  media: { count?: number } | null; scheduled_for: string | null; published_at: string | null; created_at: string; permalink: string | null; error: string | null;
  review_note?: string | null; created_by: string | null; insights?: PostInsights | null; insights_at?: string | null; post_urn: string | null;
};

function toPlannerPost(r: Row, names: Map<string, string>): PlannerPost {
  return {
    id: r.id, platform: r.platform as PlannerPost["platform"], status: r.status, postsAs: r.author_name,
    text: r.payload?.text ?? (r.body_text === "(picture post)" ? "" : r.body_text),
    pictures: r.payload?.imagePaths?.length ?? r.media?.count ?? 0,
    plannedFor: r.scheduled_for, publishedAt: r.published_at, createdAt: r.created_at, at: plannerAt(r),
    url: r.permalink, error: r.error, reviewNote: r.review_note ?? null, createdBy: r.created_by ? names.get(r.created_by) ?? null : null,
    insights: r.insights ?? null, insightsAt: r.insights_at ?? null,
  };
}

/** Every post that touches the window: published, planned, drafts and those waiting for approval. */
export async function listPlannerPosts(businessId: string, fromIso: string, toIso: string): Promise<{ ready: boolean; posts: PlannerPost[] }> {
  const cols = "id, platform, status, author_name, body_text, payload, media, scheduled_for, published_at, created_at, permalink, error, created_by, post_urn";
  let ready = true;
  let { data, error } = await db().from("linkedin_posts").select(`${cols}, review_note, insights, insights_at`).eq("business_id", businessId)
    .or(`published_at.gte.${fromIso},scheduled_for.gte.${fromIso},status.in.(draft,pending_approval),created_at.gte.${fromIso}`).order("created_at", { ascending: false }).limit(500);
  if (error && notReady(error.code)) {
    ready = false;
    ({ data, error } = await db().from("linkedin_posts").select(cols).eq("business_id", businessId)
      .or(`published_at.gte.${fromIso},scheduled_for.gte.${fromIso},created_at.gte.${fromIso}`).order("created_at", { ascending: false }).limit(500));
  }
  if (error) throw new Error("Posts could not be loaded.");
  const rows = (data ?? []) as Row[];
  const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const { data: people } = userIds.length ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.name || p.email || "Team member"]));
  const posts = rows.map((r) => toPlannerPost(r, names))
    .filter((p) => p.status === "draft" || p.status === "pending_approval" || (p.at >= fromIso && p.at <= toIso));
  return { ready, posts };
}

function checkPlanned(plannedFor: string | null | undefined): string | null {
  if (!plannedFor) return null;
  const when = Date.parse(plannedFor);
  if (Number.isNaN(when)) throw new Error("That date and time isn't valid.");
  if (when > Date.now() + MAX_AHEAD_MS) throw new Error("Posts can be planned up to 60 days ahead.");
  return new Date(when).toISOString();
}

/** Saves a draft, or submits it for the owner's approval. Never posts anything. */
export async function saveDraft(input: {
  businessId: string; userId: string; platform: MetaPlatform; text: string;
  /** Left out when editing a draft's words: its pictures stay as they are. */
  imagePaths?: string[] | undefined; plannedFor?: string | null | undefined;
  draftId?: string | undefined; submit: boolean; source: "app" | "assistant" | "mcp";
}): Promise<{ id: string; status: PlannerStatus }> {
  const text = input.text.trim();
  let imagePaths = input.imagePaths;
  if (!imagePaths && input.draftId) {
    const { data } = await db().from("linkedin_posts").select("payload").eq("id", input.draftId).eq("business_id", input.businessId).maybeSingle();
    imagePaths = ((data as { payload?: { imagePaths?: string[] } } | null)?.payload?.imagePaths) ?? [];
  }
  imagePaths = imagePaths ?? [];
  if (input.submit) {
    const problem = metaPostProblem(input.platform, text, imagePaths.length);
    if (problem) throw new Error(problem);
  } else if (!text && !imagePaths.length) throw new Error("Write something or add a picture first.");
  for (const path of imagePaths) if (!ownImagePath(input.businessId, path)) throw new Error("One of the pictures isn't from this business.");
  const plannedFor = checkPlanned(input.plannedFor);
  const { authorUrn, postsAs } = await metaAuthor(input.businessId, input.platform);
  const status: PlannerStatus = input.submit ? "pending_approval" : "draft";
  const values = {
    platform: input.platform, author_urn: authorUrn, author_name: postsAs, body_text: text || "(picture post)", status,
    scheduled_for: plannedFor, payload: { text, imagePaths }, review_note: null, error: null,
    media: imagePaths.length ? { kind: "image", count: imagePaths.length, summary: `${imagePaths.length} picture${imagePaths.length === 1 ? "" : "s"}` } : null,
  };
  if (input.draftId) {
    const { data, error } = await db().from("linkedin_posts").update(values).eq("id", input.draftId).eq("business_id", input.businessId)
      .in("status", ["draft", "pending_approval"]).select("id").maybeSingle();
    if (error) throw new Error(notReady(error.code) ? NOT_READY : "Could not save the draft.");
    if (!data) throw new Error("That draft has already been approved or removed.");
    return { id: input.draftId, status };
  }
  const { data, error } = await db().from("linkedin_posts").insert({ ...values, business_id: input.businessId, source: input.source, created_by: input.userId }).select("id").single();
  if (error || !data) throw new Error(notReady(error?.code) ? NOT_READY : "Could not save the draft.");
  await supabaseAdmin.from("audit_events").insert({ business_id: input.businessId, user_id: input.userId, event_type: input.submit ? "social_post_submitted" : "social_post_drafted", entity_type: "business", entity_id: input.businessId, metadata: { post_id: data.id, platform: input.platform } });
  return { id: (data as { id: string }).id, status };
}

/**
 * The owner's approval: the one step that reaches Facebook or Instagram.
 * With a planned time at least five minutes away it is scheduled for then;
 * otherwise it is published now. Claimed first, so it goes out once.
 */
export async function approvePost(input: { businessId: string; userId: string; postId: string; when?: string | null | undefined }): Promise<{ status: "scheduled" | "published"; scheduledFor?: string; url?: string | null }> {
  const { data: row, error } = await db().from("linkedin_posts").select("id, platform, status, payload, scheduled_for").eq("id", input.postId).eq("business_id", input.businessId).maybeSingle();
  if (error) throw new Error(notReady(error.code) ? NOT_READY : "That post could not be read.");
  const post = row as { id: string; platform: string; status: string; payload: { text?: string; imagePaths?: string[] } | null; scheduled_for: string | null } | null;
  if (!post || !["draft", "pending_approval"].includes(post.status)) throw new Error("That post isn't waiting for approval any more.");
  if (post.platform !== "facebook" && post.platform !== "instagram") throw new Error("Only Facebook and Instagram posts are approved here.");
  const platform = post.platform as MetaPlatform;
  const text = post.payload?.text ?? "";
  const imagePaths = post.payload?.imagePaths ?? [];
  const problem = metaPostProblem(platform, text, imagePaths.length);
  if (problem) throw new Error(problem);
  const plannedFor = checkPlanned(input.when === undefined ? post.scheduled_for : input.when);
  const approved = { approved_by: input.userId, approved_at: new Date().toISOString(), review_note: null };
  if (plannedFor && Date.parse(plannedFor) >= Date.now() + MIN_LEAD_MS) {
    const { data } = await db().from("linkedin_posts").update({ ...approved, status: "scheduled", scheduled_for: plannedFor })
      .eq("id", post.id).eq("status", post.status).select("id").maybeSingle();
    if (!data) throw new Error("That post was changed while you were approving it. Open it again.");
    await supabaseAdmin.from("audit_events").insert({ business_id: input.businessId, user_id: input.userId, event_type: "social_post_approved", entity_type: "business", entity_id: input.businessId, metadata: { post_id: post.id, platform, scheduled_for: plannedFor } });
    return { status: "scheduled", scheduledFor: plannedFor };
  }
  const { data: claimed } = await db().from("linkedin_posts").update({ ...approved, status: "publishing" }).eq("id", post.id).eq("status", post.status).select("id").maybeSingle();
  if (!claimed) throw new Error("That post was changed while you were approving it. Open it again.");
  await supabaseAdmin.from("audit_events").insert({ business_id: input.businessId, user_id: input.userId, event_type: "social_post_approved", entity_type: "business", entity_id: input.businessId, metadata: { post_id: post.id, platform, now: true } });
  const r = await publishMetaPost({ businessId: input.businessId, userId: input.userId, platform, text, imagePaths, source: "app", existingPostId: post.id });
  return { status: "published", url: r.url };
}

/** Sends a post back to its writer as a draft, with the owner's note. */
export async function sendBackPost(input: { businessId: string; postId: string; note: string }) {
  const { data, error } = await db().from("linkedin_posts").update({ status: "draft", review_note: input.note.trim().slice(0, 500) || "Sent back for changes." })
    .eq("id", input.postId).eq("business_id", input.businessId).eq("status", "pending_approval").select("id").maybeSingle();
  if (error) throw new Error(notReady(error.code) ? NOT_READY : "Could not send it back.");
  if (!data) throw new Error("That post isn't waiting for approval any more.");
  return { ok: true };
}

/** Removes a draft (or a post waiting for approval). Published posts are never touched. */
export async function discardDraft(businessId: string, postId: string) {
  const { data, error } = await db().from("linkedin_posts").update({ status: "cancelled" }).eq("id", postId).eq("business_id", businessId)
    .in("status", ["draft", "pending_approval"]).select("id").maybeSingle();
  if (error || !data) throw new Error("That draft has already been approved or removed.");
  return { ok: true };
}

// ------------------------------------------------------------------ performance

/** Reads the latest figures for one published Facebook or Instagram post and stores them. */
export async function refreshPostInsights(businessId: string, postId: string, fetcher: typeof fetch = fetch): Promise<PostInsights> {
  const { data } = await db().from("linkedin_posts").select("id, platform, status, post_urn").eq("id", postId).eq("business_id", businessId).maybeSingle();
  const post = data as { platform: string; status: string; post_urn: string | null } | null;
  if (!post || post.status !== "published" || !post.post_urn) throw new Error("Figures are only available once a post is published.");
  if (post.platform !== "facebook" && post.platform !== "instagram") throw new Error("Figures are read for Facebook and Instagram posts.");
  const account = await loadMetaAccount(businessId);
  const call = graph(account, fetcher);
  let insights: PostInsights;
  if (post.platform === "facebook") {
    const body = await call("GET", post.post_urn, {
      fields: "insights.metric(post_impressions,post_impressions_unique,post_clicks),reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    }).catch(async () => call("GET", post.post_urn!, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" }));
    insights = facebookInsights(body);
  } else {
    const media = await call("GET", post.post_urn, { fields: "like_count,comments_count" }).catch(() => ({} as Record<string, unknown>));
    const metrics: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> = [];
    // Asked one by one: Instagram refuses the whole request if any metric doesn't apply to this media.
    for (const metric of ["reach", "views", "saved", "shares"]) {
      const r = await call("GET", `${post.post_urn}/insights`, { metric }).catch(() => null);
      const d = (r?.["data"] as typeof metrics | undefined) ?? [];
      metrics.push(...d);
    }
    insights = instagramInsights(media, metrics);
  }
  await db().from("linkedin_posts").update({ insights, insights_at: new Date().toISOString() }).eq("id", postId).eq("business_id", businessId);
  return insights;
}

/** From the follow-ups hook: posts published in the last 30 days get fresh figures every six hours. */
export async function sweepPostInsights(limit = 15): Promise<{ refreshed: number }> {
  const since = new Date(Date.now() - INSIGHTS_FOR_DAYS * 86400_000).toISOString();
  const stale = new Date(Date.now() - INSIGHTS_EVERY_MS).toISOString();
  const { data, error } = await db().from("linkedin_posts").select("id, business_id").eq("status", "published").in("platform", ["facebook", "instagram"])
    .not("post_urn", "is", null).gte("published_at", since).or(`insights_at.is.null,insights_at.lt.${stale}`).order("published_at", { ascending: false }).limit(limit);
  if (error) return { refreshed: 0 };
  let refreshed = 0;
  for (const row of (data ?? []) as Array<{ id: string; business_id: string }>) {
    try { await refreshPostInsights(row.business_id, row.id); refreshed++; } catch {
      // Mark it read so one broken post doesn't hold the queue.
      await db().from("linkedin_posts").update({ insights_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  return { refreshed };
}
