import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock('@/lib/email-campaigns.server', () => ({ createEmailCampaign: mocks.create }));
import { buildAssistantTools, type AssistantToolContext } from './assistant-tools.server';

describe('Campaign tool request boundaries', () => {
  const context: AssistantToolContext = {
    client: {} as AssistantToolContext['client'], businessId: 'test-business', userId: 'test-owner',
    role: 'owner', timeZone: 'Australia/Sydney', attachment: null, request: 'Create an email campaign',
    record: vi.fn(), propose: vi.fn(),
  };
  it('rejects model-invented email recipients before saving a draft', async () => {
    const execute = buildAssistantTools(context).draft_email_campaign.execute;
    if (!execute) throw new Error('Missing email tool');
    const result = await execute({ leadIds: ['00000000-0000-4000-8000-000000000001'], name: 'Invented', subject: 'Offer', bodyText: '15% off' }, { toolCallId: 'test', messages: [], context: {} });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(context.record).not.toHaveBeenCalled();
  });
  it('rejects a guessed SMS audience before reading or mutating records', async () => {
    const execute = buildAssistantTools({ ...context, request: 'Draft a campaign' }).draft_campaign.execute;
    if (!execute) throw new Error('Missing SMS tool');
    const result = await execute({ audience: 'uncontacted', status: null, leadIds: null, percent: 15, offerText: null, campaignCopy: null, maxLeads: 9, olderThanDays: null }, { toolCallId: 'test', messages: [], context: {} });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(context.propose).not.toHaveBeenCalled();
  });
});