import { MATCH_CUSTOMER_LANGUAGE, OWNER_TRANSLATION_LINE, splitOwnerTranslation } from './customer-language';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { loadMetaAccount, describeGraphFailure, type DirectMetaAccount } from './meta-direct.server';
import { readMetaAppConfig } from './meta-oauth.server';
import { mapConversations, mapFacebookComments, mapInstagramComments, replyWindow, type IncomingComment, type IncomingMessage, type SocialPlatform } from './meta-social';

/**
 * Facebook & Instagram comments and DMs, read and answered with the business's
 * own Page token (the same encrypted connection as lead import). Nothing is ever
 * posted or sent without an owner's explicit approval in BookedSecure.
 *
 * Until the Meta app is published, Meta delivers no live webhooks, so the
 * five-minute sweep fetches new items; webhooks (once live) just trigger the same
 * fetch immediately.
 */
const FIRST_SYNC_MS = 3 * 86400_000;
/** Comments are re-read over this window every time; existing ones are skipped. */
const COMMENT_WINDOW_MS = 30 * 86400_000;
const OVERLAP_MS = 10 * 60_000;
const MIN_GAP_MS = 4 * 60_000;
const MAX_DRAFTS_PER_RUN = 6;

function transport(account: DirectMetaAccount, fetcher: typeof fetch) {
  const version = readMetaAppConfig().version;
  async function call(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, json?: unknown) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetcher(url, { method, headers: { Authorization: `Bearer ${account.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    } catch { throw new Error('Facebook could not be reached. Please try again.'); }
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok || (body && typeof body === 'object' && 'error' in body)) throw new Error(describeGraphFailure(res.status, body));
    return body as Record<string, unknown>;
  }
  return {
    async instagramAccount(): Promise<{ id: string; username: string | null } | null> {
      const r = await call('GET', account.pageId, { fields: 'instagram_business_account{id,username}' });
      const ig = (r['instagram_business_account'] ?? null) as { id?: string; username?: string } | null;
      return ig?.id ? { id: ig.id, username: ig.username ?? null } : null;
    },
    async facebookComments(since: Date, adStoryIds: string[], errors: string[]): Promise<IncomingComment[]> {
      const fields = 'id,message,permalink_url,comments.order(reverse_chronological).limit(50){id,message,created_time,from,permalink_url}';
      const posts: unknown[] = [];
      // Page timeline posts.
      posts.push(...(((await call('GET', `${account.pageId}/feed`, { fields, limit: '15' }))['data'] as unknown[]) ?? []));
      // Ad posts (lead ads): found through the ad account, read with the Page token.
      for (const id of adStoryIds) {
        try { posts.push(await call('GET', id, { fields })); }
        catch (e) { errors.push(`Ad comments: ${e instanceof Error ? e.message : 'failed'}`); break; }
      }
      // Fallback when ad access isn't connected: the Page's ad posts edge.
      if (!adStoryIds.length) {
        try { posts.push(...(((await call('GET', `${account.pageId}/ads_posts`, { fields, limit: '15' }))['data'] as unknown[]) ?? [])); }
        catch { errors.push('Ad comments need ad access: reconnect Facebook with the ad account.'); }
      }
      const seen = new Set<string>();
      return mapFacebookComments(posts as Parameters<typeof mapFacebookComments>[0], account.pageId, since).filter((c) => !seen.has(c.commentId) && (seen.add(c.commentId), true));
    },
    async instagramComments(igId: string, igUsername: string | null, since: Date): Promise<IncomingComment[]> {
      const r = await call('GET', `${igId}/media`, { fields: 'id,caption,permalink,comments_count,comments.limit(50){id,text,username,timestamp}', limit: '15' });
      return mapInstagramComments(((r['data'] as unknown[]) ?? []) as Parameters<typeof mapInstagramComments>[0], igUsername, since);
    },
    async conversations(platform: SocialPlatform, ownIds: string[], since: Date): Promise<IncomingMessage[]> {
      const r = await call('GET', `${account.pageId}/conversations`, {
        platform: platform === 'instagram' ? 'instagram' : 'messenger', limit: '20',
        fields: 'id,updated_time,participants,messages.limit(25){id,message,created_time,from,sticker,attachments{mime_type}}',
      });
      const convs = (((r['data'] as Array<{ updated_time?: string }>) ?? [])).filter((c) => !c.updated_time || Date.parse(c.updated_time) >= since.getTime());
      return mapConversations(platform, convs as Parameters<typeof mapConversations>[1], ownIds);
    },
    async replyToComment(platform: SocialPlatform, commentId: string, text: string): Promise<string | null> {
      const r = await call('POST', platform === 'instagram' ? `${commentId}/replies` : `${commentId}/comments`, { message: text });
      return typeof r['id'] === 'string' ? r['id'] : null;
    },
    async sendMessage(recipientId: string, text: string, window: { messagingType: 'RESPONSE' | 'MESSAGE_TAG'; tag?: 'HUMAN_AGENT' }): Promise<string | null> {
      const r = await call('POST', `${account.pageId}/messages`, {}, { recipient: { id: recipientId }, messaging_type: window.messagingType, ...(window.tag ? { tag: window.tag } : {}), message: { text } });
      return typeof r['message_id'] === 'string' ? r['message_id'] : null;
    },
  };
}

/** text null = the AI judged that no reply is needed (spam, unrelated). */
export type DraftResult = { ok: true; text: string | null; english?: string | null } | { ok: false; reason: string };

/** A short, friendly suggested reply. The owner always edits/approves before anything is sent. */
export async function draftReply(businessId: string, kind: 'comment' | 'message', platform: SocialPlatform, customerText: string): Promise<DraftResult> {
  try {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, reason: 'the AI service is not configured' };
    const { checkAiCap, recordAiUsage } = await import('./usage.server');
    if ((await checkAiCap(businessId)).blocked) return { ok: false, reason: "this month's AI limit is reached" };
    const { data: biz } = await supabaseAdmin.from('businesses').select('name, slug').eq('id', businessId).maybeSingle();
    const base = process.env['PUBLIC_APP_URL'] ?? 'https://bookedsecure.com';
    const quote = biz?.slug ? `${base}/quote/${biz.slug}` : null;
    const { generateText, streamText } = await import('ai');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const { withAiBackup } = await import('./tenant-ai.server');
    const { ANALYSIS_MODEL } = await import('./ai.server');
    const system = [
      `You write short replies for ${biz?.name ?? 'a local service business'} to a customer's ${platform} ${kind === 'comment' ? 'public comment' : 'direct message'}.`,
      'Be warm, plain and brief (1-2 sentences, under 280 characters). No emojis unless the customer used them.',
      MATCH_CUSTOMER_LANGUAGE,
      OWNER_TRANSLATION_LINE,
      'Never state prices, discounts, availability or guarantees. Never ask for personal details in a public comment.',
      quote ? `When they want a price or booking, invite them to get a quote at ${quote}${kind === 'comment' ? ' or send a message' : ''}.` : 'When they want a price or booking, invite them to send a message.',
      'If the comment needs no reply (spam, unrelated), reply with exactly: NO_REPLY',
    ].join('\n');
    const prompt = `Customer wrote: """${customerText.slice(0, 1500)}"""\nWrite the reply only.`;
    const gateway = createOpenAICompatible({ name: 'lovable', baseURL: 'https://ai.gateway.lovable.dev/v1', headers: { 'Lovable-API-Key': apiKey, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' } });
    const result = await withAiBackup({
      businessId, role: 'fast', usage: { source: 'lovable' },
      gateway: async () => { const r = await generateText({ model: gateway(ANALYSIS_MODEL), system, prompt }); return { text: r.text, input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 }; },
      backup: async (provider) => { const r = streamText({ ...provider, maxRetries: 0, system, prompt, onError: () => undefined }); const u = await r.usage; return { text: await r.text, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 }; },
    });
    await recordAiUsage({ businessId, purpose: `social_${kind}_draft`, model: ANALYSIS_MODEL, inputTokens: result.input, outputTokens: result.output }).catch(() => undefined);
    const text = result.text.trim().replace(/^"|"$/g, '');
    if (!text) return { ok: false, reason: 'the AI returned nothing' };
    if (text === 'NO_REPLY') return { ok: true, text: null };
    const { reply, english } = splitOwnerTranslation(text);
    return { ok: true, text: reply.replace(/^"|"$/g, '').slice(0, 500) || null, english };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : 'the AI could not be reached' };
  }
}

/** Fetches new comments and DMs for one business. Safe to call often (debounced). */
export async function syncSocial(businessId: string, options: { force?: boolean; fetcher?: typeof fetch; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const { data: state } = await supabaseAdmin.from('meta_social_state').select('*').eq('business_id', businessId).maybeSingle();
  const last = state?.comments_synced_at ? Date.parse(state.comments_synced_at) : 0;
  if (!options.force && last && now.getTime() - last < MIN_GAP_MS) return { skipped: true as const };
  const account = await loadMetaAccount(businessId);
  const t = transport(account, fetcher);
  const since = new Date(last ? last - OVERLAP_MS : now.getTime() - FIRST_SYNC_MS);
  const errors: string[] = [];
  let ig = state?.ig_user_id ? { id: state.ig_user_id, username: state.ig_username ?? null } : null;
  if (!ig) { try { ig = await t.instagramAccount(); } catch (e) { errors.push(e instanceof Error ? e.message : 'Instagram account lookup failed.'); } }

  const comments: IncomingComment[] = [];
  const commentsSince = new Date(now.getTime() - COMMENT_WINDOW_MS);
  let storyIds: string[] = [];
  try { storyIds = await (await import('./meta-ads.server')).adStoryIds(businessId, fetcher); } catch (e) { errors.push(`Ads: ${e instanceof Error ? e.message : 'could not list ads'}`); }
  try { comments.push(...await t.facebookComments(commentsSince, storyIds, errors)); } catch (e) { errors.push(`Facebook comments: ${e instanceof Error ? e.message : 'failed'}`); }
  if (ig) { try { comments.push(...await t.instagramComments(ig.id, ig.username, commentsSince)); } catch (e) { errors.push(`Instagram comments: ${e instanceof Error ? e.message : 'failed'}`); } }
  const messages: IncomingMessage[] = [];
  const ownIds = [account.pageId, ...(ig ? [ig.id] : [])];
  for (const platform of ['facebook', 'instagram'] as const) {
    if (platform === 'instagram' && !ig) continue;
    try { messages.push(...await t.conversations(platform, ownIds, since)); } catch (e) { errors.push(`${platform === 'facebook' ? 'Messenger' : 'Instagram'} messages: ${e instanceof Error ? e.message : 'failed'}`); }
  }

  let drafts = 0;
  let draftFailure: string | null = null;
  const suggest = async (kind: 'comment' | 'message', platform: SocialPlatform, text: string) => {
    drafts++;
    const d = await draftReply(businessId, kind, platform, text);
    if (!d.ok) draftFailure ??= d.reason;
    return d;
  };
  let newComments = 0;
  // One lookup for all candidate comments: the 30-day window re-reads known ones.
  const known = new Set<string>();
  for (let i = 0; i < comments.length; i += 200) {
    const { data: rows } = await supabaseAdmin.from('social_comments').select('platform, comment_id').eq('business_id', businessId).in('comment_id', comments.slice(i, i + 200).map((c) => c.commentId));
    for (const r of rows ?? []) known.add(`${r.platform}:${r.comment_id}`);
  }
  for (const c of comments) {
    if (known.has(`${c.platform}:${c.commentId}`)) continue;
    // '' = looked at, no reply suggested; null = not drafted yet (picked up by a later run).
    const d = drafts < MAX_DRAFTS_PER_RUN && !draftFailure ? await suggest('comment', c.platform, c.text) : null;
    const draft = d?.ok ? (d.text ?? '') : null;
    const { error } = await supabaseAdmin.from('social_comments').insert({
      business_id: businessId, platform: c.platform, comment_id: c.commentId, comment_url: c.url, post_id: c.postId, post_text: c.postText,
      author_name: c.authorName, comment_text: c.text, needs_response: true, draft_response: draft, status: 'pending_review', commented_at: c.commentedAt,
    });
    if (!error) newComments++;
  }
  let newMessages = 0;
  for (const m of messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const { error } = await supabaseAdmin.from('social_messages').upsert({
      business_id: businessId, platform: m.platform, thread_id: m.threadId, participant_id: m.participantId, participant_name: m.participantName,
      message_id: m.messageId, direction: m.direction, body: m.body, status: m.direction === 'in' ? 'received' : 'sent', sent_at: m.sentAt,
    }, { onConflict: 'business_id,platform,message_id', ignoreDuplicates: true });
    if (error) { errors.push('Messages could not be saved.'); break; }
    if (m.direction === 'in') newMessages++;
  }
  // Draft one suggested reply per conversation whose latest message is from the customer.
  const latestByThread = new Map<string, IncomingMessage>();
  for (const m of messages) { const k = `${m.platform}:${m.participantId}`; const prev = latestByThread.get(k); if (!prev || prev.sentAt < m.sentAt) latestByThread.set(k, m); }
  for (const m of latestByThread.values()) {
    if (m.direction !== 'in' || drafts >= MAX_DRAFTS_PER_RUN || draftFailure) continue;
    const d = await suggest('message', m.platform, m.body);
    const draft = d.ok ? d.text : null;
    if (draft) await supabaseAdmin.from('social_messages').update({ draft_reply: draft }).eq('business_id', businessId).eq('platform', m.platform).eq('message_id', m.messageId);
  }
  // Comments that arrived without a suggestion (busy run or AI unavailable) get one now.
  if (drafts < MAX_DRAFTS_PER_RUN && !draftFailure) {
    const { data: waiting } = await supabaseAdmin.from('social_comments').select('id, platform, comment_text')
      .eq('business_id', businessId).eq('status', 'pending_review').eq('needs_response', true).is('draft_response', null)
      .order('created_at', { ascending: false }).limit(MAX_DRAFTS_PER_RUN - drafts);
    for (const row of waiting ?? []) {
      if (draftFailure) break;
      const d = await suggest('comment', row.platform === 'instagram' ? 'instagram' : 'facebook', row.comment_text);
      if (d.ok) await supabaseAdmin.from('social_comments').update({ draft_response: d.text ?? '' }).eq('id', row.id).eq('business_id', businessId).is('draft_response', null);
    }
  }
  if (draftFailure) errors.push(`Suggested replies paused: ${draftFailure}`);
  await supabaseAdmin.from('meta_social_state').upsert({
    business_id: businessId, ig_user_id: ig?.id ?? null, ig_username: ig?.username ?? null,
    comments_synced_at: now.toISOString(), messages_synced_at: now.toISOString(),
    last_error: errors.length ? errors.join(' ').slice(0, 500) : null, updated_at: now.toISOString(),
  }, { onConflict: 'business_id' });
  return { skipped: false as const, newComments, newMessages, errors, instagram: Boolean(ig) };
}

/** Five-minute sweep: every business with a connected Facebook Page. Never affects lead imports. */
export async function sweepSocial() {
  const { data, error } = await supabaseAdmin.from('meta_lead_accounts').select('business_id').not('page_id', 'is', null).limit(25);
  if (error) return { synced: 0 };
  let synced = 0;
  for (const a of data ?? []) {
    try { const r = await syncSocial(a.business_id); if (!r.skipped) synced++; } catch { /* recorded per business on the next successful run */ }
  }
  return { synced };
}

/** Posts the owner-approved reply to a comment. Called only from the approve action. */
export async function postCommentReply(businessId: string, rowId: string, fetcher: typeof fetch = fetch): Promise<{ posted: boolean; error?: string }> {
  const { data: row, error } = await supabaseAdmin.from('social_comments').select('id, platform, comment_id, approved_response, status, api_key_id')
    .eq('id', rowId).eq('business_id', businessId).maybeSingle();
  if (error || !row) throw new Error('Comment not found.');
  if (row.status !== 'approved' || !row.approved_response) return { posted: false, error: 'This reply is not approved.' };
  const platform = z.enum(['facebook', 'instagram']).safeParse(row.platform);
  if (!platform.success) return { posted: false, error: 'Replies can only be posted to Facebook or Instagram.' };
  try {
    const account = await loadMetaAccount(businessId);
    await transport(account, fetcher).replyToComment(platform.data, row.comment_id, row.approved_response);
    await supabaseAdmin.from('social_comments').update({ status: 'posted', posted_at: new Date().toISOString(), post_error: null }).eq('id', row.id).eq('business_id', businessId).eq('status', 'approved');
    return { posted: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'The reply could not be posted.';
    await supabaseAdmin.from('social_comments').update({ status: 'failed', post_error: reason.slice(0, 500) }).eq('id', row.id).eq('business_id', businessId).eq('status', 'approved');
    return { posted: false, error: reason };
  }
}

/** Sends the owner's DM reply, respecting Meta's 24-hour / 7-day (human agent) rules. */
export async function sendSocialMessage(businessId: string, userId: string, platform: SocialPlatform, participantId: string, text: string, fetcher: typeof fetch = fetch, now = new Date()) {
  const { data: lastIn, error } = await supabaseAdmin.from('social_messages').select('thread_id, participant_name, sent_at')
    .eq('business_id', businessId).eq('platform', platform).eq('participant_id', participantId).eq('direction', 'in')
    .order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('Could not load the conversation.');
  if (!lastIn) throw new Error('Conversation not found.');
  const window = replyWindow(lastIn.sent_at, now);
  if (!window.allowed) throw new Error(window.reason);
  const account = await loadMetaAccount(businessId);
  try {
    const messageId = await transport(account, fetcher).sendMessage(participantId, text, window);
    await supabaseAdmin.from('social_messages').insert({ business_id: businessId, platform, thread_id: lastIn.thread_id, participant_id: participantId, participant_name: lastIn.participant_name, message_id: messageId, direction: 'out', body: text, status: 'sent', sent_by: userId, sent_at: now.toISOString() });
    await supabaseAdmin.from('social_messages').update({ draft_reply: null }).eq('business_id', businessId).eq('platform', platform).eq('participant_id', participantId).not('draft_reply', 'is', null);
    return { sent: true as const };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'The message could not be sent.';
    await supabaseAdmin.from('social_messages').insert({ business_id: businessId, platform, thread_id: lastIn.thread_id, participant_id: participantId, participant_name: lastIn.participant_name, message_id: null, direction: 'out', body: text, status: 'failed', error: reason.slice(0, 500), sent_by: userId, sent_at: now.toISOString() });
    throw new Error(reason);
  }
}
