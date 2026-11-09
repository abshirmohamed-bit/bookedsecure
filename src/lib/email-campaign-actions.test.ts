import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  get: vi.fn(), send: vi.fn(), schedule: vi.fn(), create: vi.fn(), audience: vi.fn(), update: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/email-campaigns.server", () => ({
  getEmailCampaign: m.get, sendEmailCampaign: m.send, scheduleEmailCampaign: m.schedule, createEmailCampaign: m.create,
  campaignAudience: m.audience, updateEmailCampaignDraft: m.update, listEmailCampaigns: vi.fn(), draftCampaignEmail: vi.fn(),
  unscheduleEmailCampaign: vi.fn(), cancelEmailCampaign: vi.fn(), stopCampaignFollowUps: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: m.from } }));

import { campaignActions, confirmationCodeFor } from "./email-campaign-actions.server";
import { buildCampaignTools } from "./assistant-tools-campaigns.server";

const actor = { businessId: "biz", userId: "user" };
const campaign = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Spring", status: "draft", subject: "Spring special", bodyText: "Hi there", fromAddress: "onboarding@resend.dev",
  followUp: null, audienceLabel: null, scheduledAt: null, sentAt: null, createdAt: "2026-11-09T00:00:00Z",
  recipients: [{ leadId: "a", name: "Jess", email: "jess@x.com", status: "pending", followUpStatus: null, booked: false, sentAt: null, error: null, followUpSentAt: null, followUpError: null }],
  counts: { total: 1, pending: 1, sent: 0, failed: 0, skipped: 0, followUpsSent: 0, followUpsWaiting: 0, booked: 0 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockReturnValue({ insert: () => Promise.resolve({ error: null }) });
});

describe("sending needs a fresh confirmation", () => {
  it("previews what will go out with a code, and sends only with that code", async () => {
    m.get.mockResolvedValue(campaign());
    m.send.mockResolvedValue({ sent: 1, failed: 0, skipped: 0 });
    const preview = await campaignActions.previewSend(actor, { campaignId: campaign().id });
    expect(preview.summary).toMatchObject({ subject: "Spring special", recipients: 1, firstRecipients: ["Jess"] });
    await expect(campaignActions.send(actor, { campaignId: campaign().id, confirmationCode: "WRONG000" })).rejects.toThrow(/Preview it again/);
    expect(m.send).not.toHaveBeenCalled();
    await expect(campaignActions.send(actor, { campaignId: campaign().id, confirmationCode: preview.confirmationCode })).resolves.toMatchObject({ sent: 1 });
  });

  it("invalidates the code when the wording or recipients change", async () => {
    const before = await confirmationCodeFor(campaign());
    expect(await confirmationCodeFor(campaign({ subject: "Changed" }))).not.toBe(before);
    expect(await confirmationCodeFor(campaign({ recipients: [] }))).not.toBe(before);
    expect(await confirmationCodeFor(campaign())).toBe(before);
  });

  it("refuses to preview a campaign that was already sent", async () => {
    m.get.mockResolvedValue(campaign({ status: "sent" }));
    await expect(campaignActions.previewSend(actor, { campaignId: campaign().id })).rejects.toThrow(/can't be sent again/);
  });

  it("builds a draft from an audience", async () => {
    m.audience.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    m.create.mockResolvedValue({ campaignId: campaign().id, emailable: 2, skippedNoEmail: 0, skippedUnsubscribed: 0 });
    m.get.mockResolvedValue(campaign());
    await campaignActions.create(actor, { name: "Spring", subject: "Spring special", bodyText: "Hi there", audience: "past", followUp: { subject: "Last chance", bodyText: "Ends Friday", delayDays: 3 } });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ leadIds: ["a", "b"], audienceLabel: "Past customers", followUp: expect.objectContaining({ delayDays: 3, stopOnBooking: true }) }));
  });
});

describe("in-app assistant campaign tools", () => {
  const ctx = (role: "owner" | "staff") => ({
    client: {} as never, businessId: "biz", userId: "user", role, timeZone: "Australia/Sydney",
    record: vi.fn(), propose: vi.fn(), attachment: null, request: "Email all past customers about our spring special", requestHasContext: true,
  });
  type Exec = (input: Record<string, unknown>, options?: unknown) => Promise<Record<string, unknown>>;

  it("covers the whole workflow", () => {
    expect(Object.keys(buildCampaignTools(ctx("owner"))).sort()).toEqual([
      "cancel_email_campaign", "draft_email_campaign", "email_campaign_audience", "email_campaign_details", "list_email_campaigns",
      "preview_email_campaign_send", "schedule_email_campaign", "send_email_campaign", "stop_email_campaign_follow_ups",
      "unschedule_email_campaign", "update_email_campaign", "write_campaign_email",
    ]);
  });

  it("lets only the owner send", async () => {
    const tools = buildCampaignTools(ctx("staff"));
    const result = await (tools.send_email_campaign.execute as unknown as Exec)({ campaignId: campaign().id, confirmationCode: "ABCD1234" });
    expect(result).toMatchObject({ ok: false });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("reports the real send result and records it", async () => {
    m.get.mockResolvedValue(campaign());
    m.send.mockResolvedValue({ sent: 1, failed: 0, skipped: 0 });
    const c = ctx("owner");
    const tools = buildCampaignTools(c);
    const code = await confirmationCodeFor(campaign());
    const result = await (tools.send_email_campaign.execute as unknown as Exec)({ campaignId: campaign().id, confirmationCode: code });
    expect(result).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(c.record).toHaveBeenCalledWith("Sent an email campaign: 1 sent.");
  });
});
