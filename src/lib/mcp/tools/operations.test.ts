import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ context: vi.fn(), execute: vi.fn(), rpc: vi.fn() }));
vi.mock('@lovable.dev/mcp-js', () => ({ defineTool: (x: unknown) => x, ToolError: class extends Error {} }));
vi.mock('../supabase', () => ({ callerContext: mocks.context, jsonResult: (x: unknown) => x }));
vi.mock('@/lib/assistant-operations', () => ({ executeAssistantOperation: mocks.execute }));
import update from './update-customer';
import book from './book-job';
import complete from './complete-job';
import request from './request-account-action';
type TestTool = { handler: (input: unknown, context: unknown) => Promise<unknown> };
const tool = (x: unknown) => x as TestTool;
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ client: { rpc: mocks.rpc }, businessId: 'verified-business' }); mocks.execute.mockResolvedValue({ ok: true }); });
describe('external assistant shared operations', () => {
  it.each([[update, 'update_customer'], [book, 'book_job'], [complete, 'complete_job']])('uses exactly the Cowork action boundary', async (definition, action) => {
    await tool(definition).handler({ ownerWords: 'exact' }, {});
    expect(mocks.execute).toHaveBeenCalledWith({ rpc: mocks.rpc }, action, { ownerWords: 'exact' });
  });
  it('refuses unapproved callers before any save', async () => {
    mocks.context.mockRejectedValue(new Error('OAuth connection required'));
    await expect(tool(update).handler({}, {})).rejects.toThrow('OAuth');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('persists broader requests as pending, never executes or sends them', async () => {
    mocks.rpc.mockResolvedValue({ data: { prepared: true, executed: false, awaiting_confirmation: true }, error: null });
    await expect(tool(request).handler({ request: 'Draft a campaign' }, {})).resolves.toMatchObject({ result: { executed: false, awaiting_confirmation: true } });
    expect(mocks.rpc).toHaveBeenCalledWith('prepare_connected_assistant_request', { p_request: 'Draft a campaign' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('never reports approval storage failure as success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Trial ended' } });
    await expect(tool(request).handler({ request: 'Draft a campaign' }, {})).rejects.toThrow('Trial ended');
  });
});