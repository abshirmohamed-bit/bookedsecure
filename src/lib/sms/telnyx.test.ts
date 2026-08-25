import { describe, expect, it } from "vitest";
import {
  createTelnyxProvider,
  buildTelnyxSendPayload,
  flattenTelnyxPayload,
  mapTelnyxStatus,
  telnyxFinalCost,
  verifyTelnyxSignature,
} from "./telnyx.server";
import { generateKeyPairSync, sign } from "node:crypto";

const inboundEvent = {
  data: {
    event_type: "message.received",
    id: "evt_in_1",
    occurred_at: "2026-08-25T01:00:00Z",
    payload: {
      id: "msg_in_1",
      direction: "inbound",
      from: { phone_number: "+61412345678" },
      to: [{ phone_number: "+61480000111", status: "received" }],
      text: "STOP",
      received_at: "2026-08-25T01:00:00Z",
    },
  },
};

const finalizedEvent = {
  data: {
    event_type: "message.finalized",
    id: "evt_fin_1",
    payload: {
      id: "msg_out_1",
      from: { phone_number: "+61480000111" },
      to: [{ phone_number: "+61412345678", status: "delivered" }],
      cost: { amount: "0.0421", currency: "AUD" },
      errors: [],
    },
  },
};

describe("outbound payload creation", () => {
  it("builds an E.164 v2 Messages payload", () => {
    expect(
      buildTelnyxSendPayload({
        to: "0412 345 678",
        from: "+61480000111",
        body: "Hi",
        messagingProfileId: "mp_1",
        webhookUrl: "https://x.test/api/public/sms/telnyx?t=s",
      }),
    ).toEqual({
      from: "+61480000111",
      to: "+0412345678",
      text: "Hi",
      messaging_profile_id: "mp_1",
      webhook_url: "https://x.test/api/public/sms/telnyx?t=s",
    });
  });

  it("omits optional fields when absent", () => {
    const payload = buildTelnyxSendPayload({ to: "+61412345678", from: "+61480000111", body: "Hi" });
    expect(payload).toEqual({ from: "+61480000111", to: "+61412345678", text: "Hi" });
  });
});

describe("telnyx status mapping", () => {
  it("maps every documented status", () => {
    expect(mapTelnyxStatus("queued")).toBe("queued");
    expect(mapTelnyxStatus("sending")).toBe("sent");
    expect(mapTelnyxStatus("sent")).toBe("sent");
    expect(mapTelnyxStatus("delivered")).toBe("delivered");
    expect(mapTelnyxStatus("sending_failed")).toBe("failed");
    expect(mapTelnyxStatus("delivery_failed")).toBe("undelivered");
    expect(mapTelnyxStatus("expired")).toBe("undelivered");
    expect(mapTelnyxStatus("nonsense")).toBe("unknown");
    expect(mapTelnyxStatus(undefined)).toBe("unknown");
  });
});

describe("inbound payload parsing", () => {
  it("flattens nested webhook data", () => {
    const flat = flattenTelnyxPayload(inboundEvent as never);
    expect(flat).toMatchObject({
      eventType: "message.received",
      eventId: "evt_in_1",
      messageId: "msg_in_1",
      from: "+61412345678",
      to: "+61480000111",
      text: "STOP",
      status: "received",
    });
  });

  it("reads final cost from message.finalized", () => {
    expect(telnyxFinalCost(finalizedEvent as never)).toBeCloseTo(0.0421);
    expect(mapTelnyxStatus(flattenTelnyxPayload(finalizedEvent as never).status)).toBe("delivered");
  });
});

describe("signature verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const publicKeyBase64 = rawPublic.toString("base64");

  it("accepts a valid signature over timestamp|rawBody", async () => {
    const rawBody = JSON.stringify(inboundEvent);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString(
      "base64",
    );
    const headers = new Headers({
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    });
    await expect(
      verifyTelnyxSignature({ headers, rawBody, publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: true });
  });

  it("rejects a tampered body", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|original`), privateKey).toString("base64");
    const headers = new Headers({
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    });
    const result = await verifyTelnyxSignature({ headers, rawBody: "tampered", publicKeyBase64 });
    expect(result.verified).toBe(false);
  });

  it("rejects missing headers and stale timestamps", async () => {
    await expect(
      verifyTelnyxSignature({ headers: new Headers(), rawBody: "x", publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: false });

    const stale = String(Math.floor(Date.now() / 1000) - 4000);
    const signature = sign(null, Buffer.from(`${stale}|x`), privateKey).toString("base64");
    await expect(
      verifyTelnyxSignature({
        headers: new Headers({
          "telnyx-signature-ed25519": signature,
          "telnyx-timestamp": stale,
        }),
        rawBody: "x",
        publicKeyBase64,
      }),
    ).resolves.toMatchObject({ verified: false });
  });
});

describe("production fail-closed", () => {
  const provider = createTelnyxProvider({
    verifySharedSecret: async () => ({ verified: true }),
  });

  it("falls back to the shared secret outside production", async () => {
    delete process.env["TELNYX_PUBLIC_KEY"];
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    await expect(
      provider.verifyWebhook({
        headers: new Headers(),
        rawBody: "{}",
        url: "https://x.test/api/public/sms/telnyx?t=s",
        params: {},
      }),
    ).resolves.toMatchObject({ verified: true });
    process.env["NODE_ENV"] = prev;
  });

  it("rejects when the public key is missing in production", async () => {
    delete process.env["TELNYX_PUBLIC_KEY"];
    const prevNode = process.env["NODE_ENV"];
    const prevVitest = process.env["VITEST"];
    delete process.env["VITEST"];
    process.env["NODE_ENV"] = "production";
    const result = await provider.verifyWebhook({
      headers: new Headers(),
      rawBody: "{}",
      url: "https://x.test/api/public/sms/telnyx?t=s",
      params: {},
    });
    expect(result.verified).toBe(false);
    process.env["NODE_ENV"] = prevNode;
    if (prevVitest !== undefined) process.env["VITEST"] = prevVitest;
  });
});
