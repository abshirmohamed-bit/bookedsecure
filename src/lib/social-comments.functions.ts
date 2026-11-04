import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

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
    let update: Record<string, unknown>;
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
    return row;
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
