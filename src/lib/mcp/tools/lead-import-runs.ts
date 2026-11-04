import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'lead_import_runs', title: 'Facebook lead import history',
  description: 'List recent Facebook lead import runs for the connected business with their status and counts: new leads, already-in records, updated (enriched) records, skipped and failed. Use lead_import_run_items with a run id for per-lead detail.',
  inputSchema: { limit: z.number().int().min(1).max(20).default(10) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('lead_sync_runs')
      .select('id, trigger_kind, status, since, created_count, duplicate_count, enriched_count, skipped_count, failed_count, error, requested_at, completed_at')
      .eq('business_id', businessId).order('requested_at', { ascending: false }).limit(limit);
    if (error) throw new ToolError('Could not read the import history.');
    return jsonResult({ runs: data ?? [] });
  },
});
