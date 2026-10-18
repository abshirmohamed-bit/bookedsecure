import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { decryptAiKey, encryptAiKey } from './tenant-ai-crypto.server';
import { isCreditExhaustion, type TenantAiProvider } from './tenant-ai';
import { directAiProvider, verifyAiAccount, type AiAccount } from './tenant-ai-provider.server';

export async function loadAiAccount(businessId: string): Promise<AiAccount | null> {
  const { data, error } = await supabaseAdmin.from('tenant_ai_accounts').select('provider,model,key_ciphertext,enabled').eq('business_id', businessId).maybeSingle();
  if (error) throw new Error('Could not load your AI connection.');
  if (!data?.enabled) return null;
  return { provider: data.provider as TenantAiProvider, model: data.model, apiKey: decryptAiKey(data.key_ciphertext, `${businessId}:${data.provider}:${data.model}`) };
}
export async function aiConnectionStatus(businessId: string) {
  const [{ data, error }, state] = await Promise.all([
    supabaseAdmin.from('tenant_ai_accounts').select('provider,model,enabled,updated_at').eq('business_id', businessId).maybeSingle(),
    supabaseAdmin.from('ai_gateway_state').select('paused').eq('id', 'lovable').maybeSingle(),
  ]);
  if (error || state.error) throw new Error('Could not load AI connection settings.');
  return { connected: Boolean(data), provider: data?.provider ?? null, model: data?.model ?? null, enabled: data?.enabled ?? false, gatewayPaused: state.data?.paused ?? false };
}
export async function saveAiAccount(businessId: string, userId: string, account: AiAccount) {
  await verifyAiAccount(account);
  const ciphertext = encryptAiKey(account.apiKey, `${businessId}:${account.provider}:${account.model}`);
  const { error } = await supabaseAdmin.from('tenant_ai_accounts').upsert({ business_id: businessId, provider: account.provider, model: account.model, key_ciphertext: ciphertext, enabled: true, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error('Your AI connection could not be saved.');
  await supabaseAdmin.from('audit_events').insert({ business_id: businessId, user_id: userId, event_type: 'tenant_ai_connected', entity_type: 'business', entity_id: businessId, metadata: { provider: account.provider, model: account.model } });
}
export async function disconnectAiAccount(businessId: string, userId: string) {
  const { error } = await supabaseAdmin.from('tenant_ai_accounts').delete().eq('business_id', businessId);
  if (error) throw new Error('Your AI connection could not be removed.');
  await supabaseAdmin.from('audit_events').insert({ business_id: businessId, user_id: userId, event_type: 'tenant_ai_disconnected', entity_type: 'business', entity_id: businessId });
}

export type BackupUsage = { source: 'lovable' | 'tenant'; model?: string };
/** Only a confirmed 402 switches provider. Never replay a turn after tools started. */
export async function withAiBackup<T>(input: {
  businessId: string;
  gateway: () => Promise<T>;
  backup: (provider: ReturnType<typeof directAiProvider>) => Promise<T>;
  canReplay?: () => boolean;
  usage?: BackupUsage;
}): Promise<T> {
  const { data: state, error } = await supabaseAdmin.from('ai_gateway_state').select('paused').eq('id', 'lovable').maybeSingle();
  if (error) throw new Error('Could not check AI availability.');
  if (!state?.paused) {
    try { return await input.gateway(); }
    catch (failure) {
      if (!isCreditExhaustion(failure)) throw failure;
      const { error: pauseError } = await supabaseAdmin.from('ai_gateway_state').upsert({ id: 'lovable', paused: true, reason: 'credits_exhausted', updated_at: new Date().toISOString() });
      if (pauseError) throw new Error('AI credit availability could not be saved.');
      if (input.canReplay && !input.canReplay()) throw new Error('AI credits ran out after work started. Review the saved changes before making a new request.');
    }
  }
  const account = await loadAiAccount(input.businessId);
  if (!account) throw new Error('Lovable AI credits are exhausted. Connect a backup AI account in AI connections or wait for credits to be restored.');
  if (input.usage) { input.usage.source = 'tenant'; input.usage.model = account.model; }
  try { return await input.backup(directAiProvider(account)); }
  catch { throw new Error('Your backup AI could not finish this request. Check your provider’s billing, model access or reconnect your key.'); }
}