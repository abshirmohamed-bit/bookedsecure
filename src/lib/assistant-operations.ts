import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';
import { operationInputs, type OperationName } from './assistant-operation-contracts';
import { normaliseAuMobile } from './domain';
import { zonedWallTimeToIso } from './assistant-time';

export async function executeAssistantOperation(client: SupabaseClient<Database>, action: OperationName, raw: unknown) {
  const input = operationInputs[action].parse(raw);
  let payload: Record<string, unknown> = { ...input };
  // Not the database's to see: whether the customer is told is decided here.
  const notifyCustomer = 'notifyCustomer' in input ? input.notifyCustomer !== false : true;
  delete payload['notifyCustomer'];
  let businessId: string | null = null;
  if ('mobile' in input && input.mobile) {
    const mobile = normaliseAuMobile(input.mobile);
    if (!mobile) throw new Error('Provide a valid Australian mobile number.');
    payload['mobile'] = mobile;
  }
  if ('date' in input && 'time' in input) {
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError || !identity.user) throw new Error('Sign in to use assistant actions.');
    const { data, error } = await client.from('profiles').select('business_id').eq('id', identity.user.id).single();
    if (error || !data?.business_id) throw new Error('Your business could not be read.');
    businessId = data.business_id;
    const business = await client.from('businesses').select('timezone').eq('id', data.business_id).single();
    if (business.error || !business.data?.timezone) throw new Error('Your business timezone could not be read.');
    const startsAt = zonedWallTimeToIso(input.date, input.time, business.data.timezone);
    if (!startsAt) throw new Error('Choose a valid local date and time.');
    payload = { ...payload, startsAt };
  }
  const { data, error } = await client.rpc('assistant_operational_action', { p_action: action, p_input: payload as Json });
  if (error || !data) throw new Error(error?.message ?? 'Nothing was saved.');
  const result = { ...(data as Record<string, unknown>) } as OperationResult;
  // A new booking gets the customer's confirmation email and text, on every
  // path that books: Co-Work and ChatGPT/Claude both come through here.
  if (action === 'book_job' && result.outcome === 'created_booking' && result.jobId && businessId && 'leadId' in input) {
    try {
      const { confirmIfNewBooking } = await import('./booking-email.server');
      await confirmIfNewBooking({ businessId, jobId: result.jobId, leadId: input.leadId, notifyCustomer });
      result.customerNotified = notifyCustomer;
    } catch { /* a confirmation problem never undoes a booking */ }
  }
  // The database only counts rows for bulk status changes; for every other
  // action its "updated: 0" is a placeholder that reads like a failure.
  if (action !== 'bulk_update_lead_status') {
    delete result.updated;
    delete result.changed;
  }
  if (action === 'update_customer' && 'leadId' in input) {
    const changedFields = Object.entries(input)
      .filter(([key, value]) => key !== 'leadId' && value !== null && value !== undefined)
      .map(([key]) => key);
    // Read the record back so the reply reports what is actually saved now.
    const { data: lead } = await client.from('leads')
      .select('name, mobile_number, email, suburb, status, opted_out_at')
      .eq('id', input.leadId).maybeSingle();
    return {
      ...result,
      saved: true,
      changedFields,
      savedCustomer: lead
        ? { name: lead.name, mobile: lead.mobile_number, email: lead.email, suburb: lead.suburb, status: lead.status, optedOut: Boolean(lead.opted_out_at) }
        : null,
    } as OperationResult;
  }
  return result;
}

export type OperationResult = {
  ok: true;
  id?: string;
  updated?: number;
  changed?: number;
  summary?: string;
  saved?: boolean;
  outcome?: string;
  jobId?: string;
  scheduledAt?: string | null;
  serviceName?: string | null;
  status?: string | null;
  changedFields?: string[];
  savedCustomer?: { name: string | null; mobile: string | null; email: string | null; suburb: string | null; status: string | null; optedOut: boolean } | null;
  customerNotified?: boolean;
};