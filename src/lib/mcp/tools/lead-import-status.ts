import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'lead_import_status', title: 'Facebook lead import status',
  description: 'Read the Facebook lead import connection status for the connected business (its direct Facebook connection): whether it is set up, whether automatic five-minute imports are on, the next scheduled check, the last success or error, and when an instant lead (sent by Facebook the moment it was submitted) last arrived. Never returns secrets or webhook addresses.',
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin.from('lead_sync_connections')
      .select('provider, auto_sync_enabled, initial_lookback_days, status, last_success_at, last_attempt_at, next_check_at, last_error')
      .eq('business_id', businessId).eq('provider', 'meta_direct');
    if (error) throw new ToolError('Could not read the import status.');
    const data = (rows ?? [])[0];
    if (!data) return jsonResult({ configured: false });
    // Evidence that instant leads work: the latest import Facebook triggered itself (read with the caller's own access).
    const { data: lastInstant } = await client.from('lead_sync_runs').select('requested_at, created_count')
      .eq('business_id', businessId).eq('trigger_kind', 'webhook').order('requested_at', { ascending: false }).limit(1);
    return jsonResult({
      configured: true,
      source: 'direct_facebook',
      connected: data.status !== 'disconnected',
      status: data.status,
      auto_sync_enabled: data.auto_sync_enabled,
      initial_lookback_days: data.initial_lookback_days,
      next_check_at: data.next_check_at,
      last_attempt_at: data.last_attempt_at,
      last_success_at: data.last_success_at,
      last_error: data.last_error,
      last_instant_lead_at: lastInstant?.[0]?.requested_at ?? null,
    });
  },
});
