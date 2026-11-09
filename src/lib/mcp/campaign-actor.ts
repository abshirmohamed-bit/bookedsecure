import { ToolError, type ToolContext } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult, supabaseForUser } from './supabase';
import type { CampaignActor } from '@/lib/email-campaign-actions.server';

type WriteAction = 'draft' | 'update' | 'write' | 'preview' | 'send' | 'schedule' | 'unschedule' | 'cancel' | 'stop_follow_ups';

/**
 * Who is acting on email campaigns through ChatGPT or Claude. Reads use the
 * caller's own business; every write goes through mcp_email_campaign_authorize,
 * which checks the OAuth connection, owner role and plan, confirms the campaign
 * is theirs and writes the audit entry before anything changes.
 */
export async function campaignActor(ctx: ToolContext, write?: { action: WriteAction; campaignId?: string | null; metadata?: Record<string, unknown> }): Promise<CampaignActor> {
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError('An authorized account connection is required.');
  if (!write) {
    const { businessId } = await callerContext(ctx);
    return { businessId, userId };
  }
  const client = supabaseForUser(ctx);
  const { data, error } = await client.rpc('mcp_email_campaign_authorize', {
    p_action: write.action,
    ...(write.campaignId ? { p_campaign_id: write.campaignId } : {}),
    p_metadata: (write.metadata ?? {}) as never,
  });
  if (error || !data) throw new ToolError(error?.message ?? 'Only the business owner can change email campaigns through this connection.');
  return { businessId: data, userId };
}

/** Runs a campaign action and turns its errors into tool errors. */
export async function campaignResult<T>(work: () => Promise<T>) {
  try {
    return jsonResult(await work());
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(error instanceof Error ? error.message : 'That did not work. Nothing was changed.');
  }
}
