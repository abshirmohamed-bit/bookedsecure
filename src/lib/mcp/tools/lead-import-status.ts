import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'lead_import_status', title: 'Facebook lead import status',
  description: 'Read the Facebook lead import connection status for the connected business (direct Facebook connection if set up, otherwise Make): whether it is set up, whether automatic five-minute imports are on, the next scheduled check, and the last success or error. Never returns secrets or webhook addresses.',
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { businessId } = await callerContext(ctx);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin.from('lead_sync_connections')
      .select('provider, auto_sync_enabled, initial_lookback_days, status, last_success_at, last_attempt_at, next_check_at, last_error, trigger_url')
      .eq('business_id', businessId).in('provider', ['meta_direct', 'make']);
    if (error) throw new ToolError('Could not read the import status.');
    const live = (rows ?? []).filter((r) => r.status !== 'disconnected' && (r.provider === 'meta_direct' || Boolean(r.trigger_url)));
    const data = live.find((r) => r.provider === 'meta_direct') ?? live[0] ?? (rows ?? [])[0];
    if (!data) return jsonResult({ configured: false });
    return jsonResult({
      configured: true,
      source: data.provider === 'meta_direct' ? 'direct_facebook' : 'make',
      connected: live.includes(data),
      status: data.status,
      auto_sync_enabled: data.auto_sync_enabled,
      initial_lookback_days: data.initial_lookback_days,
      next_check_at: data.next_check_at,
      last_attempt_at: data.last_attempt_at,
      last_success_at: data.last_success_at,
      last_error: data.last_error,
    });
  },
});
