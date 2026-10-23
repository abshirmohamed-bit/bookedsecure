import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { operationInputs, type OperationName } from '@/lib/assistant-operation-contracts';
import { executeAssistantOperation } from '@/lib/assistant-operations';
import { callerContext, jsonResult } from './supabase';

export function operationTool(name: OperationName, title: string, description: string) {
  return defineTool({ name, title, description,
    inputSchema: operationInputs[name].shape,
    annotations: { readOnlyHint: false, destructiveHint: name === 'cancel_job', idempotentHint: name !== 'book_job', openWorldHint: false },
    handler: async (input, ctx) => {
      const { client } = await callerContext(ctx);
      try { return jsonResult(await executeAssistantOperation(client, name, input)); }
      catch (error) { throw new ToolError(error instanceof Error ? error.message : 'Nothing was saved.'); }
    },
  });
}