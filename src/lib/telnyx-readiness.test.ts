import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectTelnyxFacts,
  evaluateTelnyxReadiness,
  expectedTelnyxWebhookUrl,
  TELNYX_PILOT_NUMBER,
} from "./telnyx-readiness.server";
import { requirePlatformAdmin } from "./pilot.server";

const senderRow = {
  exists: true,
  active: false,
  assignedBusinessId: null,
  messagingProfileId: "prof_123",
};

function baseInput(overrides: Partial<Parameters<typeof evaluateTelnyxReadiness>[0]> = {}) {
  return {
    phoneNumber: TELNYX_PILOT_NUMBER,
    apiKeyPresent: true,
    publicKeyPresent: true,
    expectedWebhookUrl: "https://bookedsecure.lovable.app/api/public/sms/telnyx",
    expectedProfileId: "prof_123",
    senderRow,
    number: { status: "active", numberId: "num_1" },
    messaging: { messagingProfileId: "prof_123", messagingEnabled: true },
    profile: {
      webhookUrl: "https://bookedsecure.lovable.app/api/public/sms/telnyx",
      webhookApiVersion: "2",
    },
    ...overrides,
  };
}

function statusOf(report: ReturnType<typeof evaluateTelnyxReadiness>, id: string) {
  return report.checks.find((check) => check.id === id)?.status;
}

describe("evaluateTelnyxReadiness", () => {
  it("reports ready when every fact lines up", () => {
    const report = evaluateTelnyxReadiness(baseInput());
    expect(report.overall).toBe("ready");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails gracefully when the API key is missing and cannot look anything up", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({ apiKeyPresent: false, number: null, messaging: null, profile: null }),
    );
    expect(statusOf(report, "api_key_present")).toBe("fail");
    expect(statusOf(report, "number_active")).toBe("unknown");
    expect(statusOf(report, "webhook_url_matches")).toBe("unknown");
    expect(report.overall).toBe("not_ready");
    expect(report.checks.find((c) => c.id === "number_active")?.detail).toContain("API key");
  });

  it("fails when the Telnyx public key is missing", () => {
    const report = evaluateTelnyxReadiness(baseInput({ publicKeyPresent: false }));
    expect(statusOf(report, "public_key_present")).toBe("fail");
    expect(report.overall).toBe("not_ready");
  });

  it("fails when the number is not active at Telnyx", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({ number: { status: "pending", numberId: "num_1" } }),
    );
    expect(statusOf(report, "number_active")).toBe("fail");
  });

  it("fails when the number is attached to an unexpected messaging profile", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({ messaging: { messagingProfileId: "prof_other", messagingEnabled: true } }),
    );
    expect(statusOf(report, "profile_attached")).toBe("fail");
  });

  it("fails when the webhook URL does not point at this app", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({ profile: { webhookUrl: "https://example.com/hook", webhookApiVersion: "2" } }),
    );
    expect(statusOf(report, "webhook_url_matches")).toBe("fail");
  });

  it("ignores trailing slash differences on the webhook URL", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({
        profile: {
          webhookUrl: "https://bookedsecure.lovable.app/api/public/sms/telnyx/",
          webhookApiVersion: "2",
        },
      }),
    );
    expect(statusOf(report, "webhook_url_matches")).toBe("pass");
  });

  it("fails when the profile is not on webhook API v2", () => {
    const report = evaluateTelnyxReadiness(
      baseInput({
        profile: {
          webhookUrl: "https://bookedsecure.lovable.app/api/public/sms/telnyx",
          webhookApiVersion: "1",
        },
      }),
    );
    expect(statusOf(report, "api_v2_confirmed")).toBe("fail");
  });

  it("never claims readiness implies activation: the sender row stays inactive and unassigned", () => {
    const report = evaluateTelnyxReadiness(baseInput());
    expect(report.senderRow.active).toBe(false);
    expect(report.senderRow.assignedBusinessId).toBeNull();
  });
});

describe("collectTelnyxFacts", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("only issues read-only GET requests", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      const body = String(url).includes("/messaging_profiles/")
        ? { data: { webhook_url: "https://app/api/public/sms/telnyx", webhook_api_version: "2" } }
        : String(url).includes("/messaging")
          ? { data: { messaging_profile_id: "prof_123" } }
          : { data: [{ id: "num_1", status: "active" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const facts = await collectTelnyxFacts({ phoneNumber: TELNYX_PILOT_NUMBER, apiKey: "key" });

    expect(facts.number?.status).toBe("active");
    expect(facts.messaging?.messagingProfileId).toBe("prof_123");
    expect(facts.profile?.webhookApiVersion).toBe("2");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.some((call) => call.url.includes("/messages"))).toBe(false);
  });

  it("degrades to a readable reason when Telnyx rejects the lookup", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const facts = await collectTelnyxFacts({ phoneNumber: TELNYX_PILOT_NUMBER, apiKey: "bad" });
    expect(facts.number).toBeNull();
    expect(facts.error).toContain("401");
  });
});


describe("readiness authorization", () => {
  function fakeSupabase(role: string | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }),
          }),
        }),
      }),
    } as never;
  }

  it("rejects non platform admins", async () => {
    await expect(requirePlatformAdmin(fakeSupabase(null), "user-1")).rejects.toThrow(
      /platform administrators/i,
    );
  });

  it("allows platform admins", async () => {
    await expect(requirePlatformAdmin(fakeSupabase("platform_admin"), "user-1")).resolves.toBe("user-1");
  });
});

describe("expectedTelnyxWebhookUrl", () => {
  it("builds the app webhook route", () => {
    expect(expectedTelnyxWebhookUrl("https://bookedsecure.lovable.app/")).toBe(
      "https://bookedsecure.lovable.app/api/public/sms/telnyx",
    );
    expect(expectedTelnyxWebhookUrl(null)).toBeNull();
  });
});
