import { ToolError, type ToolContext } from '@lovable.dev/mcp-js';
import { jsonResult, supabaseForUser } from './supabase';

/**
 * Lead finder through ChatGPT or Claude. Every action goes through
 * mcp_lead_finder_authorize first (docs/mcp-lead-finder.sql), which checks the
 * OAuth connection, owner role and plan and writes the audit entry.
 */
export async function leadFinderActor(ctx: ToolContext, action: 'suggest' | 'search' | 'add', metadata: Record<string, unknown> = {}): Promise<{ businessId: string; userId: string }> {
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError('An authorized account connection is required.');
  const client = supabaseForUser(ctx) as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string; code?: string } | null }> };
  const { data, error } = await client.rpc('mcp_lead_finder_authorize', { p_action: action, p_metadata: metadata });
  if (error?.code === 'PGRST202' || error?.code === '42883') throw new ToolError('Lead finder for ChatGPT and Claude is waiting for a one-time BookedSecure update.');
  if (error || !data) throw new ToolError(error?.message ?? 'Only the business owner can use Lead finder through this connection.');
  return { businessId: data, userId };
}

export async function leadFinderResult<T>(work: () => Promise<T>) {
  try {
    return jsonResult(await work());
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(error instanceof Error ? error.message : 'That did not work. Nothing was sent.');
  }
}
