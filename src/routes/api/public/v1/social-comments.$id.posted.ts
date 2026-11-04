import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/social-comments/$id/posted')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      // Make reports back after it tried to post an approved reply.
      POST: async ({ request, params }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'social:write', 'mark_social_posted');
        if (caller instanceof Response) return caller;
        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return apiError(404, 'not_found', 'Comment not found.');
        const { apiPostedResultSchema } = await import('@/lib/api-keys');
        let body: unknown;
        try { body = await request.json(); } catch { body = { success: true }; }
        const parsed = apiPostedResultSchema.safeParse(body);
        if (!parsed.success) return apiError(400, 'invalid_body', 'Send {"success": true} or {"success": false, "error": "..."}.');
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const update = parsed.data.success
          ? { status: 'posted', posted_at: new Date().toISOString(), post_error: null }
          : { status: 'failed', post_error: parsed.data.error ?? 'Posting failed.' };
        const { data, error } = await supabaseAdmin.from('social_comments').update(update)
          .eq('id', params.id).eq('business_id', caller.businessId).eq('status', 'approved')
          .select('id, status').maybeSingle();
        if (error) { await logApiRequest(caller, 'mark_social_posted', 500, 'update_failed'); return apiError(500, 'server_error', 'Could not update the comment.'); }
        if (!data) { await logApiRequest(caller, 'mark_social_posted', 409, 'not_approved'); return apiError(409, 'not_approved', 'This comment is not waiting to be posted.'); }
        await logApiRequest(caller, 'mark_social_posted', 200, data.status);
        return apiOk({ id: data.id, status: data.status });
      },
    },
  },
});
