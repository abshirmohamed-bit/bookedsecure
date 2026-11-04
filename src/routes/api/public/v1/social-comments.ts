import { createFileRoute } from '@tanstack/react-router';

const COLUMNS = 'id, platform, comment_id, comment_url, post_id, author_name, comment_text, approved_response, status, approved_at';

export const Route = createFileRoute('/api/public/v1/social-comments')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      // Make sends each drafted comment here; it lands in the owner's inbox for review.
      POST: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest, API_CORS } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'social:write', 'create_social_comment');
        if (caller instanceof Response) return caller;
        const { apiSocialCommentSchema } = await import('@/lib/api-keys');
        let body: unknown;
        try { body = await request.json(); } catch { body = null; }
        const parsed = apiSocialCommentSchema.safeParse(body);
        if (!parsed.success) {
          await logApiRequest(caller, 'create_social_comment', 400, 'invalid_body');
          return Response.json({ ok: false, error: { code: 'invalid_body', message: 'Check the comment fields.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: API_CORS });
        }
        const c = parsed.data;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data: existing } = await supabaseAdmin.from('social_comments').select('id, status')
          .eq('business_id', caller.businessId).eq('platform', c.platform).eq('comment_id', c.comment_id).maybeSingle();
        if (existing) {
          await logApiRequest(caller, 'create_social_comment', 200, 'duplicate');
          return apiOk({ id: existing.id, status: existing.status, duplicate: true });
        }
        const commentedAt = c.created_at && !Number.isNaN(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString() : null;
        const { data, error } = await supabaseAdmin.from('social_comments').insert({
          business_id: caller.businessId, platform: c.platform, comment_id: c.comment_id,
          comment_url: c.comment_url || null, post_id: c.original_post_id ?? null, post_text: c.original_post_text ?? null,
          author_name: c.comment_author ?? null, comment_text: c.comment_text, sentiment: c.sentiment ?? null,
          needs_response: c.needs_response, response_reason: c.response_reason ?? null, draft_response: c.draft_response ?? null,
          status: c.needs_response ? 'pending_review' : 'dismissed', api_key_id: caller.keyId, commented_at: commentedAt,
        }).select('id, status').single();
        if (error || !data) {
          await logApiRequest(caller, 'create_social_comment', 500, 'insert_failed');
          return apiError(500, 'server_error', 'Could not save the comment.');
        }
        await logApiRequest(caller, 'create_social_comment', 201, 'created');
        return apiOk({ id: data.id, status: data.status, duplicate: false }, 201);
      },
      // Make polls this for owner-approved replies to post.
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'social:write', 'list_social_comments');
        if (caller instanceof Response) return caller;
        const { clampLimit } = await import('@/lib/api-keys');
        const url = new URL(request.url);
        const status = url.searchParams.get('status') ?? 'approved';
        if (!['pending_review', 'approved', 'posted', 'dismissed', 'failed'].includes(status)) return apiError(400, 'invalid_status', 'Unknown status.');
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data, error } = await supabaseAdmin.from('social_comments').select(COLUMNS)
          .eq('business_id', caller.businessId).eq('status', status)
          .order('approved_at', { ascending: true, nullsFirst: false }).limit(clampLimit(url.searchParams.get('limit')));
        if (error) { await logApiRequest(caller, 'list_social_comments', 500, 'read_failed'); return apiError(500, 'server_error', 'Could not read comments.'); }
        await logApiRequest(caller, 'list_social_comments', 200);
        return apiOk({ comments: (data ?? []).map((r) => ({ ...r, reply_text: r.approved_response })) });
      },
    },
  },
});
