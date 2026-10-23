import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';
import { operationInputs, type OperationName } from './assistant-operation-contracts';
import { normaliseAuMobile } from './domain';
import { zonedWallTimeToIso } from './assistant-time';

export async function executeAssistantOperation(client: SupabaseClient<Database>, action: OperationName, raw: unknown) {
  const input = operationInputs[action].parse(raw);
  let payload: Record<string, unknown> = { ...input };
  if ('mobile' in input && input.mobile) {
    const mobile = normaliseAuMobile(input.mobile);
    if (!mobile) throw new Error('Provide a valid Australian mobile number.');
    payload.mobile = mobile;
  }
  if ('date' in input && 'time' in input) {
    const { data, error } = await client.from('profiles').select('business_id').single();
    if (error || !data?.business_id) throw new Error('Your business could not be read.');
    const business = await client.from('businesses').select('timezone').eq('id', data.business_id).single();
    if (business.error || !business.data?.timezone) throw new Error('Your business timezone could not be read.');
    const startsAt = zonedWallTimeToIso(input.date, input.time, business.data.timezone);
    if (!startsAt) throw new Error('Choose a valid local date and time.');
    payload = { ...payload, startsAt };
  }
  // Generated types may lag new RPCs; use the existing generic Supabase RPC interface.
  const rpcClient = client as SupabaseClient;
  const { data, error } = await rpcClient.rpc('assistant_operational_action', { p_action: action, p_input: payload as Json });
  if (error || !data) throw new Error(error?.message ?? 'Nothing was saved.');
  return data as { ok: true; id?: string; updated?: number; changed?: number; summary?: string };
}