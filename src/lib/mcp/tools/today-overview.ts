import { needsReply } from '@/lib/needs-reply';
import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';

/** The same "what needs you today" view as BookedSecure Home, for the connected business only. */
export default defineTool({
  name: 'today_overview', title: 'What needs attention today',
  description: 'Read what needs the owner today, the same as BookedSecure Home: leads waiting for a reply (with names), Facebook/Instagram comments and DMs waiting for a reply, the next upcoming bookings, and new leads and bookings in the last 7 days. Use this for "what do I need to do", "anything new" or a daily summary.',
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const [waiting, waitingCount, comments, upcoming, newLeads, booked] = await Promise.all([
      client.from('lead_inbox_rows').select('id, name, service_intent, conversation_last_message_at, status, conversation_status, last_reply_at, last_outbound_sms_at')
        .eq('business_id', businessId).is('deleted_at', null).eq('conversation_status', 'needs_attention')
        .order('conversation_last_message_at', { ascending: false, nullsFirst: false }).limit(500),
      client.from('lead_inbox_rows').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).is('deleted_at', null).eq('conversation_status', 'needs_attention'),
      client.from('social_comments').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).eq('status', 'pending_review').eq('needs_response', true),
      client.from('jobs').select('id, lead_id, scheduled_at, service_performed')
        .eq('business_id', businessId).eq('completion_status', 'scheduled').gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true }).limit(5),
      client.from('leads').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).is('deleted_at', null).gte('created_at', weekAgo),
      client.from('jobs').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).gte('created_at', weekAgo).in('completion_status', ['scheduled', 'completed']),
    ]);
    if (waiting.error || waitingCount.error || upcoming.error || newLeads.error || booked.error) throw new ToolError('Today’s overview could not be read.');

    const waitingRows = (waiting.data ?? []).filter(needsReply);
    const jobs = upcoming.data ?? [];
    const names = new Map<string, string | null>();
    if (jobs.length) {
      const { data, error } = await client.from('leads').select('id, name').eq('business_id', businessId).in('id', jobs.map((j) => j.lead_id));
      if (error) throw new ToolError('Upcoming bookings could not be read.');
      for (const row of data ?? []) names.set(row.id, row.name);
    }

    // DMs live behind a caller-scoped database function; report unknown (null), never zero, if it is unavailable.
    let dmsAwaiting: number | null = null;
    const dms = await client.rpc('mcp_social_conversations', { p_limit: 50, p_offset: 0 });
    if (!dms.error && dms.data && typeof dms.data === 'object') {
      const list = (dms.data as { conversations?: Array<{ awaiting_reply?: boolean; last_customer_message_at?: string | null }> }).conversations ?? [];
      const cutoff = now.getTime() - 7 * 86_400_000;
      dmsAwaiting = list.filter((c) => c.awaiting_reply && c.last_customer_message_at && Date.parse(c.last_customer_message_at) > cutoff).length;
    }

    return jsonResult({
      as_of: now.toISOString(),
      leads_waiting_for_reply: {
        count: waitingRows.length,
        latest: waitingRows.slice(0, 5).map((l) => ({ lead_id: l.id, name: l.name, service: l.service_intent, last_message_at: l.conversation_last_message_at })),
      },
      social_comments_waiting: comments.error ? null : (comments.count ?? 0),
      social_dms_waiting: dmsAwaiting,
      upcoming_bookings: jobs.map((j) => ({ job_id: j.id, lead_id: j.lead_id, customer: names.get(j.lead_id) ?? null, scheduled_at: j.scheduled_at, service: j.service_performed })),
      last_7_days: { new_leads: newLeads.count ?? 0, bookings_made: booked.count ?? 0 },
    });
  },
});
