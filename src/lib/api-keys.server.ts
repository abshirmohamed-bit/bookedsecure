import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { API_RATE_LIMIT_PER_MINUTE, hasScope, hashApiKey, isWellFormedApiKey, readApiKey, type ApiScope } from './api-keys';

export const API_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type, idempotency-key',
};

export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: API_CORS });
}

export type ApiCaller = { keyId: string; businessId: string; scopes: string[] };

/**
 * Verifies the key, its scope, rate limit and the business subscription.
 * Returns a Response when the request must be rejected.
 */
export async function authenticateApiRequest(request: Request, scope: ApiScope | null, action: string): Promise<ApiCaller | Response> {
  const raw = readApiKey(request.headers);
  if (!raw || !isWellFormedApiKey(raw)) return apiError(401, 'invalid_api_key', 'Missing or invalid API key.');
  const hash = await hashApiKey(raw);
  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, business_id, scopes, revoked_at, request_count')
    .eq('key_hash', hash)
    .maybeSingle();
  if (error) return apiError(500, 'server_error', 'Could not verify the API key.');
  if (!key || key.revoked_at) return apiError(401, 'invalid_api_key', 'Missing or invalid API key.');
  const caller: ApiCaller = { keyId: key.id, businessId: key.business_id, scopes: key.scopes };

  if (scope && !hasScope(key.scopes, scope)) {
    await logApiRequest(caller, action, 403, 'missing_scope');
    return apiError(403, 'insufficient_scope', `This key does not have ${scope} access.`);
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from('api_key_requests')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', key.id)
    .gte('created_at', since);
  if ((count ?? 0) >= API_RATE_LIMIT_PER_MINUTE) {
    return apiError(429, 'rate_limited', `Limit is ${API_RATE_LIMIT_PER_MINUTE} requests per minute.`);
  }

  try {
    const { requireActiveSubscription } = await import('./subscription.server');
    await requireActiveSubscription(key.business_id);
  } catch {
    await logApiRequest(caller, action, 402, 'subscription_inactive');
    return apiError(402, 'subscription_inactive', 'This BookedSecure account does not have an active plan.');
  }

  await supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), request_count: (key.request_count ?? 0) + 1 })
    .eq('id', key.id);
  return caller;
}

export async function logApiRequest(caller: ApiCaller, action: string, status: number, outcome: string | null = null) {
  await supabaseAdmin.from('api_key_requests').insert({
    api_key_id: caller.keyId,
    business_id: caller.businessId,
    action,
    status_code: status,
    outcome,
  });
}

export function apiOk(body: Record<string, unknown>, status = 200): Response {
  return Response.json({ ok: true, ...body }, { status, headers: API_CORS });
}
