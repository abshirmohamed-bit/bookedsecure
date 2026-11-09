import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'set_lead_import_schedule', title: 'Turn the five-minute Facebook lead check on or off',
  description: 'Turn the automatic five-minute Facebook lead check on or off (auto_sync), and/or set how far back the first import looks (lookback_days: 1, 7, 14, 30 or 90). The five-minute check is the backup to instant leads, so recommend keeping it on. Null leaves a setting unchanged. Owner only; Facebook must already be connected in BookedSecure.',
  inputSchema: {
    auto_sync: z.boolean().nullable().default(null),
    lookback_days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30), z.literal(90)]).nullable().default(null),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ auto_sync, lookback_days }, ctx) => {
    if (auto_sync === null && lookback_days === null) throw new ToolError('Say whether to turn the five-minute check on or off, or how far back to look.');
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('mcp_set_lead_import_schedule', {
      ...(auto_sync === null ? {} : { p_auto_sync: auto_sync }),
      ...(lookback_days === null ? {} : { p_lookback_days: lookback_days }),
    });
    if (error || !data) throw new ToolError(error?.message ?? 'Nothing was saved.');
    return jsonResult(data);
  },
});
