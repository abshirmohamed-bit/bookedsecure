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
export const textInput = z.object({ leadId: z.string().uuid(), message: z.string().trim().min(2).max(600) }).strict();

const actions = { create_customer: customerInput, upsert_service: serviceInput, upsert_addon: addonInput, update_business_settings: settingsInput };
export type SharedActionName = keyof typeof actions;
type Client = SupabaseClient<Database>;

export async function executeSharedAction(client: Client, action: SharedActionName, raw: unknown) {
  const parsed = actions[action].parse(raw);
  const input = action === 'create_customer' && 'mobile' in parsed
    ? { ...parsed, mobile: normaliseAuMobile(parsed.mobile) ?? parsed.mobile }
    : parsed;
  // The database derives identity, rechecks access and audits in the same transaction.
  const { data, error } = await client.rpc('assistant_account_action', { p_action: action, p_input: input });
  if (error || !data) throw new Error(error?.message ?? 'Nothing was saved.');
  return data as unknown as { ok: true; id: string; name: string; changed?: string[] };
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