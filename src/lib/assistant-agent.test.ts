import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), tools: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/agent-core.server', () => ({ runAgentTurn: mocks.run }));
vi.mock('@/lib/assistant-tools.server', () => ({ buildAssistantTools: mocks.tools }));
vi.mock('@/integrations/supabase/client.server', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) },
}));
import { runAssistantAgent } from './assistant-agent.server';

const input = {
  client: {} as Parameters<typeof runAssistantAgent>[0]['client'],
  businessId: 'test-business', userId: 'test-owner', role: 'owner' as const, question: 'Book Sam and prepare a text.',
};

describe('Co-Work interrupted tool work', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('LOVABLE_API_KEY', 'test-only');
    mocks.read.mockResolvedValue({ data: { name: 'Test business', timezone: 'Australia/Sydney' } });
    mocks.tools.mockReturnValue({});
  });
  it('returns partial work instead of throwing into the orchestration fallback', async () => {
    mocks.run.mockImplementation(async (options) => {
      options.onToolsStarted();
      const context = mocks.tools.mock.calls[0]?.[0];
      context.record('Booked Sam.');
      context.propose({ kind: 'send_text', leadId: 'sam', message: 'Your booking is ready.' });
      throw new Error('Provider interrupted after write');
    });
    const result = await runAssistantAgent(input);
    expect(result.executed).toEqual(['Booked Sam.']);
    expect(result.proposals).toHaveLength(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('does not throw into fallback when a tool started without recording completion', async () => {
    mocks.run.mockImplementation(async (options) => { options.onToolsStarted(); throw new Error('Lost result'); });
    expect((await runAssistantAgent(input)).executed).toEqual([]);
  });
  it('allows existing safe fallback before any tool started', async () => {
    mocks.run.mockRejectedValue(new Error('Provider unavailable'));
    await expect(runAssistantAgent(input)).rejects.toThrow('Provider unavailable');
  });
  it('passes all saved turns rather than dropping early task instructions', async () => {
    mocks.run.mockResolvedValue('Done reading.');
    await runAssistantAgent({ ...input, history: Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: `Request ${i}` })) });
    expect(mocks.run.mock.calls[0]?.[0].messages).toHaveLength(31);
    expect(mocks.run.mock.calls[0]?.[0].messages[0].content).toBe('Request 0');
  });
  it('asks for missing campaign decisions without running any tools or model', async () => {
    const result = await runAssistantAgent({ ...input, question: 'Create an email campaign' });
    expect(result.executed).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(mocks.tools).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});