import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ callerContext: vi.fn(), rpc: vi.fn() }));
vi.mock('@lovable.dev/mcp-js', () => ({ defineTool: (value: unknown) => value, ToolError: class extends Error {} }));
vi.mock('../supabase', () => ({ callerContext: mocks.callerContext, jsonResult: (value: unknown) => value }));
import notes from './update-lead-notes';
import booking from './schedule-booking';
import { z } from 'zod';
type TestTool = { handler: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>; inputSchema: Record<string, z.ZodTypeAny> };
const notesTool = notes as unknown as TestTool;
const bookingTool = booking as unknown as TestTool;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.callerContext.mockResolvedValue({ client: { rpc: mocks.rpc }, businessId: 'tenant-from-caller' });
});
describe('external assistant writes', () => {
  it('does not accept business or user identity in write arguments', async () => {
    mocks.rpc.mockResolvedValue({ data: 'saved-lead', error: null });
    await notesTool.handler({ lead_id: 'lead-123', notes: 'Requested by owner', business_id: 'other-tenant' }, {});
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_update_lead_notes', { p_lead_id: 'lead-123', p_notes: 'Requested by owner' });
    expect(Object.keys(notesTool.inputSchema)).toEqual(['lead_id', 'notes']);
  });
  it('uses the atomic booking operation with a timezone-qualified time', async () => {
    mocks.rpc.mockResolvedValue({ data: 'job-123', error: null });
    await expect(bookingTool.handler({ lead_id: 'lead-123', scheduled_at: '2026-10-21T10:00:00+11:00' }, {})).resolves.toEqual({ saved: true, job_id: 'job-123' });
    expect(mocks.rpc).toHaveBeenCalledWith('mcp_schedule_job', { p_lead_id: 'lead-123', p_scheduled_at: '2026-10-21T10:00:00+11:00' });
  });
  it('never reports a conflicting time as successfully scheduled', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'conflict' } });
    await expect(bookingTool.handler({ lead_id: 'lead-123', scheduled_at: '2026-10-21T10:00:00+11:00' }, {})).rejects.toThrow('That time is already booked. Nothing was saved.');
  });
  it('propagates owner, tenant and subscription rejections without success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only the business owner can change data through this connection.' } });
    await expect(notesTool.handler({ lead_id: 'lead-123', notes: '' }, {})).rejects.toThrow('Only the business owner');
  });
  it('rejects notes over 5000 characters', () => {
    expect(notesTool.inputSchema['notes']?.safeParse('x'.repeat(5001)).success).toBe(false);
  });
  it('rejects booking times without timezone offsets', () => {
    expect(bookingTool.inputSchema['scheduled_at']?.safeParse('2026-10-21T10:00:00').success).toBe(false);
  });
});