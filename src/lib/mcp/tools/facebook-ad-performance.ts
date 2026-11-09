import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { buildAdPerformance, type JobRow, type LeadRow, type SpendRow } from '@/lib/meta-ads';
import { callerContext, jsonResult } from '../supabase';

/** Same numbers as Results → Facebook ads in BookedSecure: spend from Meta, outcomes from BookedSecure. */
export default defineTool({
  name: 'facebook_ad_performance', title: 'Facebook ad results',
  description: 'Read Facebook ad results per campaign for the last 7, 30 or 90 days: ad spend, leads, bookings, completed jobs, cost per lead, cost per booking, cost per completed job, completed revenue and return on spend. Spend comes from the connected Facebook ad account; leads, bookings and jobs come from BookedSecure. Returns ad_account_connected=false when no ad account is connected.',
  inputSchema: { days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data: spendData, error: spendError } = await client.rpc('mcp_facebook_ad_spend', { p_days: days });
    if (spendError || !spendData) throw new ToolError(spendError?.message ?? 'Facebook ad spend could not be read.');
    const account = spendData as { connected: boolean; account_name?: string | null; currency?: string | null; last_synced_at?: string | null; last_error?: string | null; rows?: SpendRow[] };

    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString();
    const { data: leadData, error: leadError } = await client.from('leads')
      .select('id, source_campaign, campaign_id:source_metadata->ad->>campaign_id')
      .eq('business_id', businessId).eq('source_channel', 'meta').is('deleted_at', null).gte('created_at', since).limit(5000);
    if (leadError) throw new ToolError('Facebook leads could not be read.');
    const leads: LeadRow[] = (leadData ?? []).map((l) => ({ id: l.id, campaign_id: (l as { campaign_id?: string | null }).campaign_id ?? null, campaign_name: l.source_campaign }));

    const jobs: JobRow[] = [];
    for (let i = 0; i < leads.length; i += 200) {
      const { data, error } = await client.from('jobs').select('lead_id, scheduled_at, completion_status, completed_value')
        .eq('business_id', businessId).in('lead_id', leads.slice(i, i + 200).map((l) => l.id));
      if (error) throw new ToolError('Bookings for Facebook leads could not be read.');
      for (const j of data ?? []) jobs.push({ lead_id: j.lead_id, scheduled_at: j.scheduled_at, completion_status: j.completion_status, completed_value: j.completed_value === null ? null : Number(j.completed_value) });
    }

    const spend: SpendRow[] = (account.rows ?? []).map((s) => ({ campaign_id: s.campaign_id, campaign_name: s.campaign_name, date: s.date, spend: Number(s.spend) || 0, meta_leads: Number(s.meta_leads) || 0 }));
    const result = buildAdPerformance(spend, leads, jobs);
    return jsonResult({
      days,
      ad_account_connected: account.connected,
      ad_account: account.connected ? { name: account.account_name ?? null, currency: account.currency ?? null, spend_last_synced_at: account.last_synced_at ?? null, last_error: account.last_error ?? null } : null,
      campaigns: result.campaigns,
      total: result.total,
      note: account.connected ? null : 'No Facebook ad account is connected, so spend is unknown; lead and booking counts are still shown. The owner can connect it under Setup, Connections.',
    });
  },
});
