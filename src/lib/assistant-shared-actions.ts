import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { normaliseAuMobile } from '@/lib/domain';

// Transport-neutral contracts: Cowork and external assistants use these same actions.
export const customerInput = z.object({
  name: z.string().min(1).max(200), mobile: z.string().min(6).max(20),
  email: z.string().email().nullable(), suburb: z.string().max(200).nullable(),
  address: z.string().max(500).nullable(), vehicle: z.string().max(200).nullable(),
  requestedService: z.string().max(500).nullable(), notes: z.string().max(5000).nullable(),
}).strict();
export const catalogFields = {
  name: z.string().min(1).max(200).nullable(),
  price: z.string().max(200).nullable().describe('Price exactly as the owner stated it.'),
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  category: z.string().max(200).nullable(), description: z.string().max(5000).nullable(),
  active: z.boolean().nullable(),
};
export const serviceInput = z.object({ serviceId: z.string().uuid().nullable(), ...catalogFields }).strict();
export const addonInput = z.object({ addonId: z.string().uuid().nullable(), ...catalogFields }).strict();
export const settingsInput = z.object({
  name: z.string().min(2).max(80).nullable(), phone_number: z.string().max(20).nullable(),
  service_area: z.string().max(300).nullable(), opening_hours: z.string().max(200).nullable(),
  sms_signature: z.string().max(80).nullable(), privacy_policy_url: z.string().max(300).nullable(),
  timezone: z.string().max(60).nullable(), quiet_hours_start: z.number().int().min(0).max(23).nullable(),
  quiet_hours_end: z.number().int().min(0).max(23).nullable(),
}).strict();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM.');
export const availabilityInput = z.object({
  online_booking: z.boolean().nullable().describe('Offer appointment times to customers online.'),
  weekly_hours: z.array(z.object({
    weekday: z.number().int().min(0).max(6).describe('0 = Sunday … 6 = Saturday'),
    start: hhmm, end: hhmm,
  }).strict()).max(21).nullable().describe('Replaces all working windows. Days left out are not bookable.'),
  earliest_booking_minutes: z.number().int().min(0).max(10080).nullable().describe('Soonest a booking can start from now.'),
  booking_window_days: z.number().int().min(1).max(30).nullable().describe('How many days ahead customers can book.'),
  travel_minutes: z.number().int().min(0).max(240).nullable().describe('Kept free before and after every job.'),
  start_every_minutes: z.number().int().min(5).max(240).nullable().describe('Gap between offered start times.'),
  reminder_hours: z.number().int().min(0).max(72).nullable().describe('Customer reminder text this many hours before; 0 turns it off.'),
}).strict();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const blockedTimeInput = z.object({
  action: z.enum(['block', 'unblock']),
  date: ymd.nullable().describe('First day, in the business timezone.'),
  until_date: ymd.nullable().describe('Last day for a multi-day block; null = same day.'),
  from: hhmm.nullable().describe('Local start time; null = start of the day.'),
  to: hhmm.nullable().describe('Local end time; null = end of the last day.'),
  reason: z.string().max(120).nullable(),
  block_id: z.string().uuid().nullable().describe('For unblock: an id from the blocked list.'),
}).strict();

/** Availability, rules and blocked time: one owner-only, audited database action for every assistant. */
export async function executeAvailabilityAction(client: Client, raw: { kind: 'update'; input: unknown } | { kind: 'blocked'; input: unknown }) {
  let action: 'update' | 'block' | 'unblock';
  let input: Record<string, unknown>;
  if (raw.kind === 'update') {
    action = 'update';
    input = Object.fromEntries(Object.entries(availabilityInput.parse(raw.input)).filter(([, v]) => v !== null));
  } else {
    const parsed = blockedTimeInput.parse(raw.input);
    action = parsed.action;
    if (action === 'unblock') {
      if (!parsed.block_id) throw new Error('Which blocked time? Read availability first and use its id.');
      input = { block_id: parsed.block_id };
    } else {
      if (!parsed.date) throw new Error('Give the date to block (YYYY-MM-DD).');
      input = Object.fromEntries(Object.entries({ date: parsed.date, until_date: parsed.until_date, from: parsed.from, to: parsed.to, reason: parsed.reason }).filter(([, v]) => v !== null));
    }
  }
  const { data, error } = await client.rpc('assistant_availability_action' as never, { p_action: action, p_input: input } as never);
  if (error || !data) throw new Error(error?.message ?? 'Nothing was saved.');
  return data as unknown as Record<string, unknown>;
}

export const textInput = z.object({ leadId: z.string().uuid(), message: z.string().trim().min(2).max(600) }).strict();

const actions = { create_customer: customerInput, upsert_service: serviceInput, upsert_addon: addonInput, update_business_settings: settingsInput };
export type SharedActionName = keyof typeof actions;
type Client = SupabaseClient<Database>;

export async function executeSharedAction(client: Client, action: SharedActionName, raw: unknown) {
  const parsed = actions[action].parse(raw);
  const input = action === 'create_customer' && 'mobile' in parsed
    ? { ...parsed, mobile: normaliseAuMobile(parsed.mobile) ?? parsed.mobile }
    : parsed;
  if (action === 'create_customer' && 'mobile' in input) {
    // Reuse an existing active customer with the same number instead of failing or duplicating.
    const { data: found, error: findError } = await client.from('leads').select('id,name')
      .eq('mobile_number', input.mobile).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
    if (findError) throw new Error('Could not check for an existing customer. Nothing was saved.');
    if (found && found[0]) return { ok: true as const, id: found[0].id, name: found[0].name ?? parsed.name, existing: true };
  }
  // The database derives identity, rechecks access and audits in the same transaction.
  const { data, error } = await client.rpc('assistant_account_action', { p_action: action, p_input: input });
  if (error || !data) throw new Error(error?.message ?? 'Nothing was saved.');
  return data as unknown as { ok: true; id: string; name: string; changed?: string[]; existing?: boolean };
}

export async function prepareAssistantText(client: Client, businessId: string, raw: unknown) {
  const input = textInput.parse(raw);
  const { data: lead, error } = await client.from('leads')
    .select('id,name,mobile_number,opted_out_at,sms_suppressed_at')
    .eq('id', input.leadId).eq('business_id', businessId).is('deleted_at', null).maybeSingle();
  if (error) throw new Error('Customer details could not be read. Please try again.');
  if (!lead) throw new Error("That customer is not in this business's records.");
  if (lead.opted_out_at) throw new Error(`${lead.name ?? 'That customer'} has opted out of texts.`);
  if (lead.sms_suppressed_at) throw new Error("That customer's number is suppressed after delivery failures.");
  if (!lead.mobile_number) throw new Error('There is no mobile number on record for that customer.');
  const leadName = lead.name ?? 'Customer';
  return { kind: 'send_text' as const, leadId: lead.id, leadName, mobileNumber: lead.mobile_number,
    message: input.message, summary: `Text to ${leadName} ready. It sends only when you confirm.` };
}