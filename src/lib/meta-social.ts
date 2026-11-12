/**
 * Facebook & Instagram comments and DMs: pure mapping and policy shared by the
 * server, the webhook and tests. Network and database live in meta-social.server.ts.
 */
export type SocialPlatform = 'facebook' | 'instagram';

/** Home's combined Facebook/Instagram card opens a network that actually has work waiting. */
export function socialReviewSearch(platform: SocialPlatform | null | undefined) {
  return { view: 'comments' as const, ...(platform ? { platform } : {}) };
}

export type IncomingComment = {
  platform: SocialPlatform;
  commentId: string;
  postId: string | null;
  postText: string | null;
  authorName: string | null;
  text: string;
  commentedAt: string | null;
  url: string | null;
};

export type IncomingMessage = {
  platform: SocialPlatform;
  messageId: string;
  threadId: string;
  participantId: string;
  participantName: string | null;
  direction: 'in' | 'out';
  body: string;
  sentAt: string;
};

type FbFrom = { id?: string; name?: string } | undefined;
type FbComment = { id?: string; message?: string; created_time?: string; from?: FbFrom; permalink_url?: string };
type FbPost = { id?: string; message?: string; permalink_url?: string; comments?: { data?: FbComment[] } };

/** Customer comments on Page posts (and ad posts). The Page's own replies are skipped. */
export function mapFacebookComments(posts: FbPost[], pageId: string, since: Date): IncomingComment[] {
  const out: IncomingComment[] = [];
  for (const p of posts) {
    for (const c of p.comments?.data ?? []) {
      if (!c.id || !c.message?.trim() || c.from?.id === pageId) continue;
      if (c.created_time && Date.parse(c.created_time) < since.getTime()) continue;
      out.push({
        platform: 'facebook', commentId: c.id, postId: p.id ?? null, postText: p.message?.slice(0, 500) ?? null,
        authorName: c.from?.name ?? null, text: c.message.trim().slice(0, 2000), commentedAt: c.created_time ?? null,
        url: c.permalink_url ?? p.permalink_url ?? null,
      });
    }
  }
  return out;
}

type IgComment = { id?: string; text?: string; username?: string; timestamp?: string; from?: { id?: string; username?: string } };
type IgMedia = { id?: string; caption?: string; permalink?: string; comments?: { data?: IgComment[] } };

/** Customer comments on Instagram posts. The business account's own replies are skipped. */
export function mapInstagramComments(media: IgMedia[], igUsername: string | null, since: Date): IncomingComment[] {
  const out: IncomingComment[] = [];
  for (const m of media) {
    for (const c of m.comments?.data ?? []) {
      const user = c.username ?? c.from?.username ?? null;
      if (!c.id || !c.text?.trim() || (igUsername && user === igUsername)) continue;
      if (c.timestamp && Date.parse(c.timestamp) < since.getTime()) continue;
      out.push({
        platform: 'instagram', commentId: c.id, postId: m.id ?? null, postText: m.caption?.slice(0, 500) ?? null,
        authorName: user, text: c.text.trim().slice(0, 2000), commentedAt: c.timestamp ?? null, url: m.permalink ?? null,
      });
    }
  }
  return out;
}

type ConvMessage = { id?: string; message?: string; created_time?: string; from?: { id?: string; name?: string; username?: string }; sticker?: string; attachments?: { data?: unknown[] } };
type Conversation = { id?: string; participants?: { data?: Array<{ id?: string; name?: string; username?: string }> }; messages?: { data?: ConvMessage[] } };

/**
 * Messages from the conversations API. `ownIds` are the Page id and the Instagram
 * account id. Every message returned for a recently active conversation is kept,
 * whatever its age, so a thread always shows the customer's side too (duplicates
 * are dropped when saving).
 */
export function mapConversations(platform: SocialPlatform, conversations: Conversation[], ownIds: string[]): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const conv of conversations) {
    if (!conv.id) continue;
    const other = (conv.participants?.data ?? []).find((p) => p.id && !ownIds.includes(p.id));
    if (!other?.id) continue;
    for (const m of conv.messages?.data ?? []) {
      // Photos, files and stickers have no text but are still part of the conversation.
      const text = m.message?.trim() || (m.sticker ? '(sticker)' : m.attachments?.data?.length ? '(photo or file)' : '');
      if (!m.id || !m.created_time || !text) continue;
      const fromUs = Boolean(m.from?.id && ownIds.includes(m.from.id));
      out.push({
        platform, messageId: m.id, threadId: conv.id, participantId: other.id,
        participantName: other.name ?? other.username ?? null, direction: fromUs ? 'out' : 'in',
        body: text.slice(0, 2000), sentAt: m.created_time,
      });
    }
  }
  return out;
}

export type ReplyWindow = { allowed: true; messagingType: 'RESPONSE' | 'MESSAGE_TAG'; tag?: 'HUMAN_AGENT' } | { allowed: false; reason: string };

/**
 * Meta's messaging rules: replies are free within 24 hours of the customer's last
 * message; a person may still reply up to 7 days with the HUMAN_AGENT tag; after
 * that the conversation is closed until the customer writes again.
 */
export function replyWindow(lastInboundAt: string | null, now = new Date()): ReplyWindow {
  if (!lastInboundAt) return { allowed: false, reason: 'The customer has not messaged you, so Meta does not allow a message to be sent.' };
  const age = now.getTime() - Date.parse(lastInboundAt);
  if (!Number.isFinite(age)) return { allowed: false, reason: 'The last customer message time is unknown.' };
  if (age <= 24 * 3600_000) return { allowed: true, messagingType: 'RESPONSE' };
  if (age <= 7 * 24 * 3600_000) return { allowed: true, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' };
  return { allowed: false, reason: 'It has been more than 7 days since the customer last wrote, so Meta no longer allows a reply here. Ask them to message you again, or call them.' };
}

/** Webhook events that should trigger an immediate fetch: comments, DMs (Facebook and Instagram). */
export function socialWebhookTargets(body: unknown): Array<{ object: 'page' | 'instagram'; id: string }> {
  if (!body || typeof body !== 'object') return [];
  const b = body as { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: { item?: string } }>; messaging?: unknown[] }> };
  if (b.object !== 'page' && b.object !== 'instagram') return [];
  const out = new Map<string, { object: 'page' | 'instagram'; id: string }>();
  for (const e of b.entry ?? []) {
    if (!e.id || !/^\d{3,40}$/.test(e.id)) continue;
    const social = (e.messaging?.length ?? 0) > 0 || (e.changes ?? []).some((c) =>
      (c.field === 'feed' && c.value?.item === 'comment') || c.field === 'comments' || c.field === 'messages');
    if (social) out.set(`${b.object}:${e.id}`, { object: b.object, id: e.id });
  }
  return [...out.values()].slice(0, 25);
}
