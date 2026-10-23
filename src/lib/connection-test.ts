import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export type ConnectionCheck = {
  stage: 'account' | 'authorization' | 'customers' | 'ready';
  message: string;
  total?: number;
  customers?: Array<{ id: string; name: string }>;
};

// This checks account readiness, not a tool call made by ChatGPT.
export async function checkChatGptConnection(client: SupabaseClient<Database>): Promise<ConnectionCheck> {
  let stage: ConnectionCheck['stage'] = 'account';
  try {
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return { stage, message: 'Your sign-in could not be verified. Sign in again to the BookedSecure account you connected in ChatGPT, then retry.' };
    stage = 'authorization';
    const grants = await client.auth.oauth.listGrants();
    if (grants.error) return { stage, message: 'Connection approvals could not be checked. Try again; if this continues, sign in again. No customer lookup was attempted.' };
    if (!grants.data?.some(grant => /\bchatgpt\b/i.test(grant.client.name ?? ''))) {
      return { stage, message: 'No ChatGPT approval was found for this account. In ChatGPT, reconnect BookedSecure and finish “Approve connection”. If the request expired, close it and start a new connection. Use the same BookedSecure account, then retry here.' };
    }
    stage = 'customers';
    const profile = await client.from('profiles').select('business_id,active').eq('id', user.data.user.id).maybeSingle();
    if (profile.error) return { stage, message: 'ChatGPT is approved, but your business access could not be checked. Retry; if it persists, contact BookedSecure.' };
    if (!profile.data?.active || !profile.data.business_id) return { stage, message: 'ChatGPT is approved, but this account has no active business. Sign in to your active business account and connect that account in ChatGPT.' };
    const result = await client.from('leads').select('id,name', { count: 'exact' })
      .eq('business_id', profile.data.business_id).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id').range(0, 4);
    if (result.error || result.count === null) return { stage, message: 'ChatGPT is approved, but the customer lookup failed. No records were changed. Retry; if it persists, contact BookedSecure to check your access.' };
    return { stage: 'ready', message: 'ChatGPT approval and a read-only customer lookup passed for this account.', total: result.count, customers: result.data ?? [] };
  } catch {
    return { stage, message: 'The check was interrupted. Check your connection and retry. No records were changed.' };
  }
}