import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'lead_import_run_items', title: 'Facebook lead import run details',
  description: 'List the per-lead results of one Facebook lead import run: each Meta lead id, its form, when it was submitted, and whether it was created, already present, updated (enriched), skipped or failed, with the reason.',
  inputSchema: { run_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ run_id }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('lead_sync_items')
      .select('meta_lead_id, form_name, submitted_at, outcome, reason, lead_id, display_name')
      .eq('business_id', businessId).eq('run_id', run_id).order('submitted_at', { ascending: false }).limit(200);
    if (error) throw new ToolError('Could not read the import details.');
    return jsonResult({ items: data ?? [] });
  },
});
