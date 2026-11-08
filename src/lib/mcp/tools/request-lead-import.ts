import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'request_lead_import', title: 'Run a Facebook lead import now',
  description: 'Start an immediate Facebook lead import for the connected business, using the saved Make connection. Owner only. The import runs in the background; check the result with lead_import_status and lead_import_runs. Never claim leads were imported until a run shows them.',
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client } = await callerContext(ctx);
    const { data: businessId, error: ownerErr } = await client.rpc('assistant_action_business', { p_require_plan: false, p_require_owner: true });
    if (ownerErr || !businessId) throw new ToolError('Only the business owner can start an import.');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: conn, error } = await supabaseAdmin.from('lead_sync_connections')
      .select('id, business_id, trigger_url, initial_lookback_days, consecutive_failures, status')
      .eq('business_id', businessId).eq('provider', 'make').maybeSingle();
    if (error) throw new ToolError('Could not load the import connection.');
    if (!conn || conn.status === 'disconnected' || !conn.trigger_url) throw new ToolError('The Facebook lead import is not set up yet. The owner can add the Make webhook address in Settings.');
    const { startSyncRun } = await import('@/lib/lead-sync.server');
    const result = await startSyncRun(conn, 'manual', ctx.getUserId() ?? null);
    if (!result.started) throw new ToolError(result.reason ?? 'The import could not be started.');
    return jsonResult({ started: true, run_id: result.runId, next_step: 'The import is running. Check lead_import_runs in a few minutes for what arrived.' });
  },
});
