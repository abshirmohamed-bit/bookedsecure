import { describe, expect, it, vi } from 'vitest';
import { campaignContactBlock, requestsAllCampaignLeads } from './campaign-audience';
const mocks = vi.hoisted(() => ({ propose: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/owner-actions.server', () => ({ proposeCampaign: mocks.propose }));
vi.mock('@/lib/subscription.server', () => ({ planGateMessage: mocks.gate }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: {} }));
import { buildAssistantTools, type AssistantToolContext } from './assistant-tools.server';

describe('all-existing-lead campaign requests', () => {
  it.each([
    'Run message campaign to all leads with 15% show me draft message first',
    'Please draft a campaign for all existing leads wether contacted or not',
    'Send the message to all 400 customers', 'All 382 leads please',
  ])('honours the requested whole audience: %s', request => {
    expect(requestsAllCampaignLeads(request)).toBe(true);
  });
  it('does not widen an uncontacted-only request', () => {
    expect(requestsAllCampaignLeads('Draft for 9 uncontacted leads')).toBe(false);
  });
  it('overrides a mistaken uncontacted audience and cap without sending', async () => {
    mocks.gate.mockResolvedValue(null);
    mocks.propose.mockResolvedValue({ campaignId: 'campaign', offerText: '15% off', summary: 'Ready', drafts: [{ leadName: 'Sam' }] });
    const propose = vi.fn();
    const ctx: AssistantToolContext = {
      client: {} as AssistantToolContext['client'], businessId: 'tenant', userId: 'owner', role: 'owner',
      timeZone: 'Australia/Sydney', request: 'Run message campaign to all leads with 15% show me draft message first',
      attachment: null, record: vi.fn(), propose,
    };
    const execute = buildAssistantTools(ctx).draft_campaign.execute;
    if (!execute) throw new Error('Campaign tool missing');
    const result = await execute({ audience: 'uncontacted', status: null, leadIds: null, percent: 20,
      offerText: null, campaignCopy: null, maxLeads: 9, olderThanDays: 30 }, { toolCallId: 'test', messages: [], context: {} });
    expect(mocks.propose).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant', audience: { kind: 'all' }, percent: 15, maxLeads: 5000, olderThanDays: null,
    }));
    expect(result).toMatchObject({ awaitingConfirmation: true, drafted: 1, audience: 'all' });
    expect(propose).toHaveBeenCalledTimes(1);
    expect(ctx.record).not.toHaveBeenCalled();
  });
});

describe('campaign opt-out safeguards', () => {
  const lead = { mobile_number: '+61412345678', status: 'contacted' };
  it('includes previously contacted customers when the audience is all', () => {
    expect(campaignContactBlock(lead)).toBeNull();
  });
  it.each([
    { opted_out_at: '2026-10-11' }, { status: 'opted_out' }, { consent_status: 'opted_out' },
    { consent_record: { opted_out: true } },
  ])('never includes an opted-out customer: %j', state => {
    expect(campaignContactBlock({ ...lead, ...state })).toBe('Lead has opted out.');
  });
  it('blocks suppressed numbers', () => {
    expect(campaignContactBlock({ ...lead, sms_suppressed_at: '2026-10-11' })).toBe('Number is suppressed.');
  });
  it('blocks deleted customers', () => {
    expect(campaignContactBlock({ ...lead, deleted_at: '2026-10-11' })).toBe('Lead is deleted.');
  });
  it('blocks landlines from SMS campaigns', () => {
    expect(campaignContactBlock({ ...lead, mobile_number: '+61298765432' })).toBe('No usable Australian mobile.');
  });
});
describe("short all-leads confirmations", () => {
  it.each(["All 382 leads please", "yes all of them", "everyone please", "send to the whole list"])("%s targets all leads", (s) => {
    expect(requestsAllCampaignLeads(s)).toBe(true);
  });
});
