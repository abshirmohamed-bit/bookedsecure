import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), create: vi.fn(), audience: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/email-campaigns.server", () => ({ createEmailCampaign: mocks.create, campaignAudience: mocks.audience }));

import { buildFeatureTools } from "./assistant-tools-features.server";
import { buildAssistantSystemPrompt } from "./owner-assistant";

type Exec = (input: Record<string, unknown>, options?: unknown) => Promise<Record<string, unknown>>;
const ctx = (role: "owner" | "staff", request = "Email all past customers about our spring special: 10% off") => ({
  client: {} as never,
  businessId: "biz-1",
  userId: "user-1",
  role,
  timeZone: "Australia/Sydney",
  record: vi.fn(),
  propose: vi.fn(),
  attachment: null,
  request,
  requestHasContext: true,
});
const run = (tools: ReturnType<typeof buildFeatureTools>, name: keyof ReturnType<typeof buildFeatureTools>, input: Record<string, unknown>) =>
  (tools[name].execute as unknown as Exec)(input, {});

beforeEach(() => vi.clearAllMocks());

describe("assistant November tools", () => {
  it("covers every new feature area", () => {
    expect(Object.keys(buildFeatureTools(ctx("owner"))).sort()).toEqual([
      "business_profile", "dismiss_social_comment", "facebook_ad_performance", "facebook_lead_import_status", "google_ad_performance", "import_facebook_leads_now",
      "list_social_comments", "list_social_conversations", "notifications_summary", "prepare_social_reply",
      "read_social_conversation", "schedule_owner_reminder", "set_facebook_lead_check", "today_overview",
    ]);
  });

  it("keeps changes owner-only", async () => {
    const tools = buildFeatureTools(ctx("staff"));
    for (const [name, input] of [
      ["prepare_social_reply", { commentId: "11111111-1111-4111-8111-111111111111", replyText: "Thanks!" }],
      ["dismiss_social_comment", { commentId: "11111111-1111-4111-8111-111111111111" }],
      ["set_facebook_lead_check", { fiveMinuteCheckOn: true }],
      ["import_facebook_leads_now", {}],
    ] as const) {
      expect(await run(tools, name, input)).toMatchObject({ ok: false });
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

});

describe("assistant instructions", () => {
  it("explains the new areas and that nothing public goes out", () => {
    const prompt = buildAssistantSystemPrompt({ businessName: "Glocast", role: "owner", timeZone: "Australia/Sydney", localDate: "2026-11-09", localTime: "10:00", localWeekday: "Monday" });
    expect(prompt).toMatch(/'instant form'.*Facebook Lead Ads/);
    expect(prompt).toMatch(/today_overview/);
    expect(prompt).toMatch(/never say a reply was posted/);
    expect(prompt).toMatch(/preview_email_campaign_send/);
    expect(prompt).toMatch(/clearly says yes/);
    expect(prompt).not.toMatch(/Lead inbox pages/);
  });
});
