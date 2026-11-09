import { ToolError, type ToolContext } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult, supabaseForUser } from './supabase';

/**
 * Who is posting to LinkedIn through ChatGPT or Claude. Reads use the caller's
 * own business; every write goes through mcp_linkedin_authorize, which checks
 * the OAuth connection, owner role and plan and writes the audit entry first.
 */
export async function linkedInActor(ctx: ToolContext, write?: { action: 'write' | 'preview' | 'publish'; metadata?: Record<string, unknown> }): Promise<{ businessId: string; userId: string }> {
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError('An authorized account connection is required.');
  if (!write) {
    const { businessId } = await callerContext(ctx);
    return { businessId, userId };
  }
  const client = supabaseForUser(ctx) as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string } | null }> };
  const { data, error } = await client.rpc('mcp_linkedin_authorize', { p_action: write.action, p_metadata: write.metadata ?? {} });
  if (error || !data) throw new ToolError(error?.message ?? 'Only the business owner can post to LinkedIn through this connection.');
  return { businessId: data, userId };
}

export async function linkedInResult<T>(work: () => Promise<T>) {
  try {
    return jsonResult(await work());
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(error instanceof Error ? error.message : 'That did not work. Nothing was posted.');
  }
}
