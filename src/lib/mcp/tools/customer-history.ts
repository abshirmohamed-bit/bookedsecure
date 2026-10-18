import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
import { visibleNotes } from '@/lib/bookings';
export default defineTool({
  name: 'customer_history', title: 'Read customer history',
  description: 'Read one previously found customer’s contact details, recent texts, jobs and follow-up state. Returns at most 50 texts and 50 jobs; never claims a truncated history is complete.',
  inputSchema: { lead_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const lead = await client.from('leads').select('id,name,email,mobile_number,suburb,service_address,vehicle_type,service_intent,status,customer_status,booking_status,notes,opted_out_at,created_at').eq('business_id', businessId).eq('id', lead_id).is('deleted_at', null).maybeSingle();
    if (lead.error) throw new ToolError('Customer details could not be read.');
    if (!lead.data) throw new ToolError('Active customer not found in your business.');
    const [messages, jobs, followUps] = await Promise.all([
      client.from('messages').select('direction,body,delivery_status,message_kind,created_at', { count: 'exact' }).eq('business_id', businessId).eq('lead_id', lead_id).order('created_at', { ascending: false }).limit(50),
      client.from('jobs').select('id,scheduled_at,completion_status,completed_at,completed_value,service_performed', { count: 'exact' }).eq('business_id', businessId).eq('lead_id', lead_id).order('scheduled_at', { ascending: false }).limit(50),
      client.from('conversations').select('status,automation_paused,next_follow_up_at,last_message_at').eq('business_id', businessId).eq('lead_id', lead_id).maybeSingle(),
    ]);
    if (messages.error || jobs.error || followUps.error) throw new ToolError('Customer history could not be fully read. Please try again.');
    return jsonResult({ customer: { ...lead.data, notes: visibleNotes(lead.data.notes) }, messages: messages.data ?? [], jobs: jobs.data ?? [], follow_up: followUps.data, messages_total: messages.count, jobs_total: jobs.count });
  },
});