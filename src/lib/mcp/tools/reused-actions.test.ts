import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const mocks = vi.hoisted(() => ({ context: vi.fn(), execute: vi.fn(), prepare: vi.fn(), rpc: vi.fn() }));
vi.mock('@lovable.dev/mcp-js', () => ({ defineTool: (value: unknown) => value, ToolError: class extends Error {} }));
vi.mock('../supabase', () => ({ callerContext: mocks.context, jsonResult: (value: unknown) => value }));
vi.mock('@/lib/assistant-shared-actions', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/assistant-shared-actions')>(), executeSharedAction: mocks.execute, prepareAssistantText: mocks.prepare }));
import customer from './create-customer';
import service from './upsert-service';
import addon from './upsert-addon';
import settings from './update-business-settings';
import text from './send-text';
type TestTool = { handler: (input: unknown, ctx: unknown) => Promise<unknown>; inputSchema: Record<string, z.ZodTypeAny> };
const asTool = (value: unknown) => value as TestTool;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ client: { rpc: mocks.rpc }, businessId: 'verified-tenant' });
  mocks.execute.mockResolvedValue({ ok: true, id: 'saved' });
});
describe('MCP reuses existing assistant actions', () => {
  it.each([[customer, 'create_customer'], [service, 'upsert_service'], [addon, 'upsert_addon'], [settings, 'update_business_settings']])('delegates to the shared action without an AI round trip', async (tool, action) => {
    await asTool(tool).handler({ name: 'Owner supplied' }, {});
    expect(mocks.execute).toHaveBeenCalledWith({ rpc: mocks.rpc }, action, { name: 'Owner supplied' });
  });
  it.each([customer, service, addon, settings, text])('does not expose identity arguments', tool => {
    expect(asTool(tool).inputSchema).not.toHaveProperty('business_id');
    expect(asTool(tool).inputSchema).not.toHaveProperty('user_id');
  });
  it('saves the shared text proposal for the existing in-app Confirm flow, not delivery', async () => {
    mocks.prepare.mockResolvedValue({ leadId: 'lead', message: 'Thanks Sarah' });
    mocks.rpc.mockResolvedValue({ data: { prepared: true, sent: false, awaiting_confirmation: true }, error: null });
    const result = await asTool(text).handler({ leadId: 'lead', message: 'Thanks Sarah' }, {});
    expect(mocks.prepare).toHaveBeenCalledWith({ rpc: mocks.rpc }, 'verified-tenant', { leadId: 'lead', message: 'Thanks Sarah' });
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_prepare_assistant_text', { p_lead_id: 'lead', p_message: 'Thanks Sarah' });
    expect(result).toMatchObject({ result: { sent: false, awaiting_confirmation: true } });
  });
  it('does not claim a reply is saved when approval storage fails', async () => {
    mocks.prepare.mockResolvedValue({ leadId: 'lead', message: 'Thanks' });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Trial ended' } });
    await expect(asTool(text).handler({ leadId: 'lead', message: 'Thanks' }, {})).rejects.toThrow('Trial ended');
  });
  it('rejects unauthorised connections before actions execute', async () => {
    mocks.context.mockRejectedValue(new Error('An authorized account connection is required.'));
    await expect(asTool(customer).handler({}, {})).rejects.toThrow('authorized account');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});