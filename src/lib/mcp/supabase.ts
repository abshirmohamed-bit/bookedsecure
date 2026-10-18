import { createClient } from '@supabase/supabase-js';
import { ToolError, type ToolContext } from '@lovable.dev/mcp-js';
import type { Database } from '@/integrations/supabase/types';

export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!ctx.isAuthenticated() || !token || !ctx.getClientId()) throw new ToolError('An authorized account connection is required.');
  const url = process.env['SUPABASE_URL'] ?? import.meta.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) throw new ToolError('Account connections are not configured.');
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function callerContext(ctx: ToolContext) {
  const client = supabaseForUser(ctx);
  const { data, error } = await client.from('profiles').select('business_id, active').eq('id', ctx.getUserId() ?? '').maybeSingle();
  if (error || !data?.active || !data.business_id) throw new ToolError('An active business account is required.');
  return { client, businessId: data.business_id };
}

export function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}