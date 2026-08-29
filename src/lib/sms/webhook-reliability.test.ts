import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createWebhookEventsMock, type WebhookEventRow } from "./webhook-events.mock";

const store = createWebhookEventsMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => store.table() },
}));

const { recordWebhookEvent, isUniqueViolation } = await import("./webhook.server");
const { verifyTelnyxSignature } = await import("./telnyx.server");

const event = {
  providerId: "telnyx",
  eventId: "evt_1",
  eventType: "message.received",
  payload: { data: { id: "evt_1" } },
  businessId: "biz_1",
  signatureVerified: true,
};

beforeEach(() => store.reset());

describe("inbound webhook persistence classification", () => {
  it("treats a unique violation (23505) as a duplicate of an already-processed event", async () => {
    store.seed({ processed_at: new Date().toISOString() });
    const result = await recordWebhookEvent(event);
    expect(result).toMatchObject({ duplicate: true, failed: false, state: "duplicate_processed" });
  });

  it("treats any other database error as a real failure, not a duplicate", async () => {
    store.insertError = {
      code: "57P01",
      message: "terminating connection due to administrator command",
    };
    const result = await recordWebhookEvent(event);
    expect(result.duplicate).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain("terminating connection");
  });

  it("records the event exactly once on success and claims it unprocessed", async () => {
    const result = await recordWebhookEvent(event);
    expect(result).toMatchObject({ duplicate: false, failed: false, state: "claimed" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processed_at).toBeNull();
    expect(store.rows[0]?.processing_started_at).toBeTruthy();
  });

  it("classifies unique violations by code and by message text only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value" })).toBe(true);
    expect(isUniqueViolation({ code: "08006", message: "connection failure" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("route acknowledgement rules", () => {
  // Mirrors the route flow: persist -> failed? 503 -> in-progress? 409 ->
  // processed duplicate? 200 -> process -> mark processed.
  async function handle(process: () => Promise<{ handled: boolean }>) {
    const { markWebhookProcessed, markWebhookFailed } = await import("./webhook.server");
    const { duplicate, failed, state } = await recordWebhookEvent(event);
    if (failed) return { status: 503, acknowledged: false };
    if (duplicate) {
      return state === "duplicate_in_progress"
        ? { status: 409, acknowledged: false }
        : { status: 200, acknowledged: true, duplicate: true };
    }
    try {
      const result = await process();
      const marked = await markWebhookProcessed(event.providerId, event.eventId);
      if (!marked.ok) return { status: 503, acknowledged: false };
      return { status: result.handled ? 200 : 202, acknowledged: true };
    } catch (error) {
      await markWebhookFailed(event.providerId, event.eventId, error);
      return { status: 503, acknowledged: false };
    }
  }

  it("returns a retryable failure when persistence fails transiently", async () => {
    store.insertError = { code: "40001", message: "could not serialize access" };
    await expect(handle(async () => ({ handled: true }))).resolves.toMatchObject({
      status: 503,
      acknowledged: false,
    });
  });

  it("does not acknowledge a processing failure and leaves the event retryable", async () => {
    const outcome = await handle(async () => {
      throw new Error("database write failed mid-processing");
    });
    expect(outcome).toMatchObject({ status: 503, acknowledged: false });
    const row = store.rows[0] as WebhookEventRow;
    expect(row.processed_at).toBeNull();
    expect(row.processing_started_at).toBeNull();
    expect(row.processing_error).toContain("database write failed");
  });

  it("keeps a processed duplicate event idempotent with a 200 acknowledgement", async () => {
    store.seed({ processed_at: new Date().toISOString() });
    const processor = vi.fn(async () => ({ handled: true }));
    const outcome = await handle(processor);
    expect(outcome).toMatchObject({ status: 200, duplicate: true });
    expect(processor).not.toHaveBeenCalled();
  });
});

describe("signature verification remains mandatory", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const rawBody = JSON.stringify({ data: { id: "evt_1" } });
  const timestamp = String(Math.floor(Date.now() / 1000));

  function headers(signature: string) {
    return new Headers({
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    });
  }

  it("accepts a correctly signed payload", async () => {
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString(
      "base64",
    );
    const result = await verifyTelnyxSignature({
      headers: headers(signature),
      rawBody,
      publicKeyBase64,
    });
    expect(result.verified).toBe(true);
  });

  it("rejects a tampered signature and a tampered body", async () => {
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString(
      "base64",
    );
    await expect(
      verifyTelnyxSignature({ headers: headers("AAAA"), rawBody, publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: false });
    await expect(
      verifyTelnyxSignature({ headers: headers(signature), rawBody: `${rawBody} `, publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: false });
  });
});
