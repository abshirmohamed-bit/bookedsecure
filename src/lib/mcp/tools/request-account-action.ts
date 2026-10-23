import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';

export default defineTool({
  name: 'request_account_action', title: 'Request any existing Cowork action for confirmation',
  description: 'Prepare an exact request for any existing Cowork capability: SMS/email campaigns, imports, deleting mistaken jobs or unfinished prospects, team access, and other account work. Saves the request in the ongoing Cowork conversation. The owner must review and Confirm in BookedSecure; Cowork then uses its existing tools and permissions. Messages and imports retain their separate approval gates. Nothing is executed by this tool.',
  inputSchema: { request: z.string().trim().min(2).max(1000).describe('The owner’s exact requested work, with customer names and previously looked-up identifiers where needed. Never invent consent or instructions.') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ request }, ctx) => {
    const { client } = await callerContext(ctx);
    const { data, error } = await client.rpc('prepare_connected_assistant_request', { p_request: request });
    if (error || !data) throw new ToolError(error?.message ?? 'The request could not be saved.');
    return jsonResult({ result: data, next_step: 'Open Home in BookedSecure and review the request. Confirm runs it through Cowork. No action or message has run yet.' });
  },
});