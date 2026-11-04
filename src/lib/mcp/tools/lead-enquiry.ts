import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'lead_enquiry', title: 'Read a lead’s full enquiry',
  description: 'Read one lead’s complete enquiry: requested service, request type (quote or service — never a confirmed booking), vehicle, address, timing, notes, the raw Facebook form answers exactly as submitted, and the linked booking if one exists. Look the lead up with list_leads or query_leads first.',
  inputSchema: { lead_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data: lead, error } = await client.from('leads')
      .select('id, name, email, mobile_number, suburb, service_address, vehicle_type, main_concerns, service_intent, request_type, service_name_snapshot, flexible_request_text, quote_status, booking_status, source_channel, source_form, source_metadata, created_at')
      .eq('business_id', businessId).eq('id', lead_id).is('deleted_at', null).maybeSingle();
    if (error) throw new ToolError('Could not read the enquiry.');
    if (!lead) throw new ToolError('No lead with that id in this business.');
    const { data: job, error: jobErr } = await client.from('jobs')
      .select('id, scheduled_at, service_performed, completion_status')
      .eq('business_id', businessId).eq('lead_id', lead_id).not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: false }).limit(1).maybeSingle();
    if (jobErr) throw new ToolError('Could not read the linked booking.');
    const meta = (lead.source_metadata ?? {}) as Record<string, unknown>;
    return jsonResult({
      lead: { ...lead, source_metadata: undefined },
      form_answers: Array.isArray(meta['form_answers']) ? meta['form_answers'] : [],
      submitted_at: meta['submitted_at'] ?? null,
      booking: job ?? null,
    });
  },
});
