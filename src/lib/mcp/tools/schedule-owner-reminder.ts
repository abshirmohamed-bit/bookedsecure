import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
import { reminderRequestKeyMaterial } from '@/lib/owner-schedule-reminder';

async function sha(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default defineTool({
  name: 'schedule_owner_reminder', title: 'Text the owner their bookings',
  description: "Schedule an SMS to the business owner's saved alert mobile listing their scheduled bookings (shifts) in a date range. BookedSecure reads the latest bookings when the text is due, so later changes are included, and delivers even if this chat is closed. Use business_settings for the timezone and give times with that offset. Omit sendAt to send as soon as possible (within about 10 minutes). Long schedules are split into several texts. Uses the business's text credits. Repeating the same request does not create a duplicate.",
  inputSchema: {
    rangeStart: z.string().datetime({ offset: true }).describe('Start of the bookings to include, e.g. tomorrow 00:00 in the business timezone.'),
    rangeEnd: z.string().datetime({ offset: true }).describe('End (exclusive) of the bookings to include.'),
    sendAt: z.string().datetime({ offset: true }).optional().describe('When to text. Omit for now.'),
    label: z.string().trim().min(1).max(80).describe("Short heading for the text, e.g. \"Tomorrow's bookings\" or \"Next 7 days\"."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async ({ rangeStart, rangeEnd, sendAt, label }, ctx) => {
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) throw new ToolError('The range end must be after its start.');
    const { client, businessId } = await callerContext(ctx);
    const when = sendAt ?? new Date().toISOString();
    const key = await sha(`${businessId}|${reminderRequestKeyMaterial({ sendAt: when, rangeStart, rangeEnd })}`);
    const { data, error } = await client.rpc('schedule_owner_sms_reminder', {
      p_send_at: when, p_range_start: rangeStart, p_range_end: rangeEnd, p_label: label, p_request_key: key,
    });
    if (error || !data) throw new ToolError(error?.message ?? 'The reminder could not be scheduled.');
    return jsonResult({ scheduled: data, note: 'Accepted by BookedSecure. The text goes to the owner alert mobile saved in Settings; delivery happens at the scheduled time (checked every 10 minutes).' });
  },
});
