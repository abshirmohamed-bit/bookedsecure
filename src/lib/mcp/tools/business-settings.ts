import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'business_settings', title: 'Read business settings',
  description: 'Read the connected business’s name, timezone, website, service area, opening hours, quote/automation state, bookable availability (working hours, booking rules, reminder) and upcoming blocked time. No credentials, billing IDs or private provider configuration are returned.',
  inputSchema: {}, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('businesses').select('name,timezone,website_url,phone_number,service_area,opening_hours,quote_mode,quote_form_active,automation_enabled').eq('id', businessId).maybeSingle();
    if (error || !data) throw new ToolError('Business settings could not be read.');
    const [availability, blocked] = await Promise.all([
      client.from('booking_availability')
        .select('active,weekly_windows,lead_time_minutes,horizon_days,travel_buffer_minutes,slot_step_minutes,customer_reminder_hours')
        .eq('business_id', businessId).maybeSingle(),
      client.from('booking_blocks').select('id,starts_at,ends_at,reason')
        .eq('business_id', businessId).gte('ends_at', new Date().toISOString()).order('starts_at').limit(50),
    ]);
    if (availability.error || blocked.error) throw new ToolError('Availability could not be read.');
    const a = availability.data;
    return jsonResult({
      business: data,
      availability: a ? {
        online_booking: a.active, weekly_hours: a.weekly_windows, earliest_booking_minutes: a.lead_time_minutes,
        booking_window_days: a.horizon_days, travel_minutes: a.travel_buffer_minutes,
        start_every_minutes: a.slot_step_minutes, reminder_hours: a.customer_reminder_hours,
      } : null,
      blocked_time: blocked.data ?? [],
    });
  },
});