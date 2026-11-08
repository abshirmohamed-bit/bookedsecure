import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';

type SocialUpdate = Database['public']['Tables']['social_comments']['Update'];

const COLUMNS = 'id, platform, comment_id, comment_url, post_text, author_name, comment_text, sentiment, response_reason, draft_response, approved_response, status, post_error, posted_at, lead_id, commented_at, created_at';
const STATUSES = ['pending_review', 'approved', 'posted', 'dismissed', 'failed'] as const;

export const listSocialComments = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ status: z.enum(STATUSES) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import('./app-context.server');
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase.from('social_comments').select(COLUMNS)
      .eq('business_id', ctx.businessId).eq('status', data.status).order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error('Could not load comments.');
    return rows ?? [];
  });

/** Approve (with the owner's final wording), dismiss, or reopen a comment. */
export const reviewSocialComment = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    action: z.enum(['approve', 'dismiss', 'reopen']),
    reply: z.string().trim().max(2000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import('./app-context.server');
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    let update: SocialUpdate;
    let allowedFrom: string[];
    if (data.action === 'approve') {
      if (!data.reply) throw new Error('Write the reply before approving.');
      update = { status: 'approved', approved_response: data.reply, approved_at: new Date().toISOString(), approved_by: ctx.userId, post_error: null };
      allowedFrom = ['pending_review', 'failed'];
    } else if (data.action === 'dismiss') {
      update = { status: 'dismissed' };
      allowedFrom = ['pending_review', 'approved', 'failed'];
    } else {
      update = { status: 'pending_review', approved_at: null, approved_response: null };
      allowedFrom = ['approved', 'dismissed', 'failed'];
    }
    const { data: row, error } = await supabaseAdmin.from('social_comments').update(update)
      .eq('id', data.id).eq('business_id', ctx.businessId).in('status', allowedFrom).select('id, status').maybeSingle();
    if (error) throw new Error('Could not update the comment.');
    if (!row) throw new Error('This comment has already changed. Refresh and try again.');
    if (data.action === 'approve') {
      // Post straight to Facebook/Instagram with the business's own connection.
      const { postCommentReply } = await import('./meta-social.server');
      const result = await postCommentReply(ctx.businessId, row.id).catch((e: unknown) => ({ posted: false, error: e instanceof Error ? e.message : 'Could not post.' }));
      return { ...row, status: result.posted ? 'posted' : 'failed', postError: result.posted ? null : (result.error ?? null) };
    }
    return row;
  });

/** Writes a suggested reply on request. Only fills the box: nothing is posted until the owner approves. */
export const suggestSocialReply = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import('./app-context.server');
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row, error } = await supabaseAdmin.from('social_comments').select('id, platform, comment_text, status')
      .eq('id', data.id).eq('business_id', ctx.businessId).maybeSingle();
    if (error || !row) throw new Error('This comment could not be found.');
    if (row.status !== 'pending_review' && row.status !== 'failed') throw new Error('This comment has already been handled.');
    const { draftReply } = await import('./meta-social.server');
    const result = await draftReply(ctx.businessId, 'comment', row.platform === 'instagram' ? 'instagram' : 'facebook', row.comment_text);
    if (!result.ok) throw new Error(`A reply could not be suggested: ${result.reason}`);
    const text = result.text ?? '';
    await supabaseAdmin.from('social_comments').update({ draft_response: text }).eq('id', row.id).eq('business_id', ctx.businessId);
    return { text, noReplyNeeded: result.text === null };
  });

/** Turns a commenter into a customer once the owner has their mobile. No text is sent. */
export const convertSocialComment = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    mobile: z.string().trim().min(8).max(20),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import('./app-context.server');
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: c, error } = await supabaseAdmin.from('social_comments').select('id, platform, comment_text, comment_url, lead_id')
      .eq('id', data.id).eq('business_id', ctx.businessId).maybeSingle();
    if (error || !c) throw new Error('Comment not found.');
    if (c.lead_id) return { leadId: c.lead_id };
    const { captureLead } = await import('./lead-engine.server');
    const result = await captureLead({
      businessId: ctx.businessId,
      name: data.name,
      mobile_number: data.mobile,
      main_concerns: `${c.platform} comment: ${c.comment_text}`.slice(0, 1000),
      source_channel: 'meta',
      utm_source: c.platform,
      consent: false,
      consent_text: 'Added by the owner from a social comment. No SMS consent recorded.',
      lead_origin: 'inbound_form',
      source_metadata: { social_comment_id: c.id, comment_url: c.comment_url },
      external_id: `social:${c.id}`,
    } as Parameters<typeof captureLead>[0]);
    await supabaseAdmin.from('social_comments').update({ lead_id: result.leadId }).eq('id', c.id).eq('business_id', ctx.businessId);
    return { leadId: result.leadId };
  });

const PLATFORM = z.enum(['facebook', 'instagram']);

/** Conversations (Facebook Messenger and Instagram), newest first, with the latest message. */
export const listSocialThreads = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.from('social_messages').select('platform, participant_id, participant_name, direction, body, sent_at, draft_reply, status')
    .eq('business_id', ctx.businessId).order('sent_at', { ascending: false }).limit(500);
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return { threads: [], setupMissing: true };
    throw new Error('Could not load messages.');
  }
  const threads = new Map<string, { platform: string; participantId: string; name: string | null; last: string; lastAt: string; lastFromCustomer: boolean; lastInboundAt: string | null; hasDraft: boolean }>();
  for (const m of data ?? []) {
    const key = `${m.platform}:${m.participant_id}`;
    let t = threads.get(key);
    if (!t) { t = { platform: m.platform, participantId: m.participant_id, name: m.participant_name, last: m.body, lastAt: m.sent_at, lastFromCustomer: m.direction === 'in', lastInboundAt: null, hasDraft: false }; threads.set(key, t); }
    if (!t.name && m.participant_name) t.name = m.participant_name;
    if (m.direction === 'in' && !t.lastInboundAt) t.lastInboundAt = m.sent_at;
    if (m.draft_reply) t.hasDraft = true;
  }
  return { threads: [...threads.values()], setupMissing: false };
});

export const getSocialThread = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM, participantId: z.string().regex(/^\d{3,40}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import('./app-context.server');
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin.from('social_messages').select('id, direction, body, sent_at, status, error, draft_reply, participant_name')
      .eq('business_id', ctx.businessId).eq('platform', data.platform).eq('participant_id', data.participantId).order('sent_at', { ascending: true }).limit(200);
    if (error) throw new Error('Could not load the conversation.');
    const { replyWindow } = await import('./meta-social');
    const lastIn = [...(rows ?? [])].reverse().find((r) => r.direction === 'in');
    const draft = [...(rows ?? [])].reverse().find((r) => r.draft_reply)?.draft_reply ?? null;
    return { messages: rows ?? [], draft, window: replyWindow(lastIn?.sent_at ?? null) };
  });

export const sendSocialReply = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM, participantId: z.string().regex(/^\d{3,40}$/), text: z.string().trim().min(1).max(1000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import('./app-context.server');
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { sendSocialMessage } = await import('./meta-social.server');
    return sendSocialMessage(ctx.businessId, ctx.userId, data.platform, data.participantId, data.text);
  });

/** Fetch new comments and messages from Facebook/Instagram now (owner/staff "Refresh"). */
export const refreshSocialNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireWriteContext } = await import('./app-context.server');
  const ctx = await requireWriteContext(context.supabase, context.userId);
  const { syncSocial } = await import('./meta-social.server');
  try {
    const r = await syncSocial(ctx.businessId, { force: true });
    return r.skipped ? { ok: true as const, newComments: 0, newMessages: 0, errors: [] as string[] } : { ok: true as const, newComments: r.newComments, newMessages: r.newMessages, errors: r.errors };
  } catch (e) {
    return { ok: false as const, reason: e instanceof Error ? e.message : 'Could not refresh.' };
  }
});

