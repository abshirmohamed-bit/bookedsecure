import { afterEach, describe, expect, it } from "vitest";
import { getMessagingProvider, resolveProviderId } from "./registry.server";
import { ProviderOperationNotSupportedError } from "./contract.server";
import { PROVIDER_CAPABILITIES, isProviderId } from "./config";
import { eventTypeForDeliveryStatus, assertTenantMatch, TenantScopeError } from "./events";
import { eventFingerprint, resolveEventId } from "./webhook.server";
import { isProductionRuntime } from "./telnyx.server";
import type { ResolvedSender } from "./provider.server";

const sender: ResolvedSender = {
  id: "sender-1",
  businessId: "biz-1",
  phoneNumber: "+61480000111",
  provider: "simulated",
  credentialMode: "platform",
  subaccountSid: null,
  credentialSecretName: null,
  messagingProfileId: null,
};

const envKeys = ["SMS_PROVIDER", "SMS_PROVIDER_OVERRIDE", "TELNYX_PUBLIC_KEY", "NODE_ENV"] as const;
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("provider selection", () => {
  it("defaults to simulated", () => {
    delete process.env["SMS_PROVIDER"];
    delete process.env["SMS_PROVIDER_OVERRIDE"];
    expect(resolveProviderId(null)).toBe("simulated");
  });

  it("uses the requested provider (normally the sender row)", () => {
    expect(resolveProviderId("telnyx")).toBe("telnyx");
  });

  it("falls back to SMS_PROVIDER for unknown requests", () => {
    process.env["SMS_PROVIDER"] = "telnyx";
    expect(resolveProviderId("not-a-provider")).toBe("telnyx");
  });

  it("SMS_PROVIDER_OVERRIDE wins over the tenant value", () => {
    process.env["SMS_PROVIDER_OVERRIDE"] = "simulated";
    expect(resolveProviderId("telnyx")).toBe("simulated");
  });

  it("only accepts the three supported providers plus legacy twilio", () => {
    expect(["simulated", "telnyx", "sinch", "twilio"].every(isProviderId)).toBe(true);
    expect(isProviderId("messagebird")).toBe(false);
  });
});

describe("simulated provider", () => {
  const provider = getMessagingProvider("simulated");

  it("sends outbound messages and returns a normalized result", async () => {
    const result = await provider.sendMessage({ to: "+61412345678", body: "Hi", sender });
    expect(result.providerId).toBe("simulated");
    expect(result.deliveryStatus).toBe("delivered");
    expect(result.providerMessageId).toMatch(/^sim_/);
  });

  it("surfaces provider failures for the retry path", async () => {
    await expect(
      provider.sendMessage({ to: "+61400000009", body: "Hi", sender }),
    ).rejects.toThrow(/simulated_provider_failure/);
  });

  it("supports the number lifecycle used by central number management", async () => {
    const number = await provider.provisionNumber({ countryCode: "+61" });
    const assigned = await provider.assignNumberToTenant({
      phoneNumber: number.phoneNumber,
      tenantId: "biz-1",
    });
    expect(assigned.assignedTenantId).toBe("biz-1");
    await provider.releaseNumber({ phoneNumber: number.phoneNumber });
    expect((await provider.getNumberStatus({ phoneNumber: number.phoneNumber })).assignedTenantId)
      .toBeNull();
  });

  it("normalizes an inbound payload without exposing provider fields", () => {
    const event = provider.normalizeWebhookEvent({
      From: "+61412345678",
      To: "+61480000111",
      Body: "STOP",
      MessageSid: "sim_1",
    });
    expect(event?.type).toBe("message.received");
    expect(event?.contactNumber).toBe("+61412345678");
    expect(event?.tenantNumber).toBe("+61480000111");
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "contactNumber",
      "deliveryStatus",
      "eventId",
      "occurredAt",
      "provider",
      "providerMessageId",
      "tenantNumber",
      "text",
      "type",
    ]);
  });
});

describe("telnyx adapter conformance", () => {
  const provider = getMessagingProvider("telnyx");

  it("declares its real capabilities", () => {
    expect(provider.capabilities).toEqual(PROVIDER_CAPABILITIES.telnyx);
    expect(provider.capabilities.signedWebhooks).toBe(true);
    expect(provider.capabilities.provisionNumber).toBe(false);
  });

  it("normalizes an inbound Telnyx event", () => {
    const event = provider.normalizeWebhookEvent({
      data: {
        event_type: "message.received",
        id: "evt_1",
        occurred_at: "2026-08-25T01:00:00Z",
        payload: {
          id: "msg_1",
          from: { phone_number: "+61412345678" },
          to: [{ phone_number: "+61480000111", status: "received" }],
          text: "Yes please",
        },
      },
    });
    expect(event?.type).toBe("message.received");
    expect(event?.text).toBe("Yes please");
    expect(event?.provider.providerId).toBe("telnyx");
  });

  it("normalizes a delivered receipt", () => {
    const event = provider.handleDeliveryUpdate({
      data: {
        event_type: "message.finalized",
        id: "evt_2",
        payload: {
          id: "msg_1",
          to: [{ phone_number: "+61412345678", status: "delivered" }],
        },
      },
    });
    expect(event?.type).toBe("message.delivered");
    expect(event?.deliveryStatus).toBe("delivered");
  });

  it("normalizes a failed receipt into message.failed", () => {
    const event = provider.handleDeliveryUpdate({
      data: {
        event_type: "message.finalized",
        id: "evt_3",
        payload: {
          id: "msg_2",
          to: [{ phone_number: "+61412345678", status: "delivery_failed" }],
          errors: [{ code: 40300 }],
        },
      },
    });
    expect(event?.type).toBe("message.failed");
    expect(event?.deliveryStatus).toBe("undelivered");
    expect(event?.provider.rawErrorCode).toBe("40300");
  });

  it("throws instead of guessing unsupported number provisioning", async () => {
    await expect(provider.provisionNumber({ countryCode: "+61" })).rejects.toBeInstanceOf(
      ProviderOperationNotSupportedError,
    );
  });

  it("fails closed in production when TELNYX_PUBLIC_KEY is missing", async () => {
    delete process.env["TELNYX_PUBLIC_KEY"];
    process.env["NODE_ENV"] = "production";
    delete process.env["VITEST"];
    expect(isProductionRuntime()).toBe(true);
    const result = await provider.validateWebhook({
      url: "https://x.test/api/public/sms/telnyx",
      params: {},
      headers: new Headers(),
      rawBody: "{}",
    });
    expect(result.verified).toBe(false);
    process.env["VITEST"] = "true";
  });
});

describe("sinch placeholder", () => {
  const provider = getMessagingProvider("sinch");

  it("advertises no capabilities", () => {
    expect(Object.values(provider.capabilities).every((value) => value === false)).toBe(true);
  });

  it("refuses to send", async () => {
    await expect(provider.sendMessage({ to: "+61412345678", body: "Hi", sender })).rejects.toThrow(
      ProviderOperationNotSupportedError,
    );
  });

  it("rejects every webhook, in every environment", async () => {
    const result = await provider.validateWebhook({
      url: "https://x.test/api/public/sms/sinch",
      params: {},
      headers: new Headers(),
      rawBody: "{}",
    });
    expect(result.verified).toBe(false);
  });
});

describe("webhook idempotency safeguards", () => {
  it("hashes identical retried payloads to the same fallback id", async () => {
    const body = JSON.stringify({ a: 1 });
    expect(await eventFingerprint("telnyx", body)).toBe(await eventFingerprint("telnyx", body));
  });

  it("separates different payloads and different providers", async () => {
    expect(await eventFingerprint("telnyx", "{}")).not.toBe(await eventFingerprint("sinch", "{}"));
    expect(await eventFingerprint("telnyx", "{}")).not.toBe(await eventFingerprint("telnyx", "{ }"));
  });

  it("prefers the provider event id and marks the source", async () => {
    expect(await resolveEventId({ providerId: "telnyx", eventId: "evt_9", rawBody: "{}" })).toEqual({
      eventId: "evt_9",
      source: "provider",
    });
    expect((await resolveEventId({ providerId: "telnyx", rawBody: "{}" })).source).toBe("hash");
  });
});

describe("event mapping and tenant isolation", () => {
  it("maps internal delivery statuses to normalized event types", () => {
    expect(eventTypeForDeliveryStatus("queued")).toBe("message.accepted");
    expect(eventTypeForDeliveryStatus("sent")).toBe("message.sent");
    expect(eventTypeForDeliveryStatus("delivered")).toBe("message.delivered");
    expect(eventTypeForDeliveryStatus("failed")).toBe("message.failed");
    expect(eventTypeForDeliveryStatus("undelivered")).toBe("message.failed");
    expect(eventTypeForDeliveryStatus("unknown")).toBeNull();
  });

  it("blocks cross-tenant writes", () => {
    expect(() => assertTenantMatch("biz-1", "biz-1")).not.toThrow();
    expect(() => assertTenantMatch("biz-1", "biz-2")).toThrow(TenantScopeError);
  });
});
