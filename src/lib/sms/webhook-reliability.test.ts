import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

// In-memory stand-in for the service-role client: only the calls
// recordWebhookEvent / releaseWebhookEvent make are modelled.
const state = {
  insertError: null as { code?: string; message?: string } | null,
  inserted: [] as Record<string, unknown>[],
  deleted: [] as { provider: string; eventId: string }[],
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          if (state.insertError) return Promise.resolve({ error: state.insertError });
          state.inserted.push(row);
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters: Record<string, string> = {};
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value;
              if (Object.keys(filters).length === 2) {
                state.deleted.push({
                  provider: filters["provider"] ?? "",
                  eventId: filters["event_id"] ?? "",
                });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  },
}));

const { recordWebhookEvent, releaseWebhookEvent, isUniqueViolation } = await import(
  "./webhook.server"
);
const { verifyTelnyxSignature } = await import("./telnyx.server");

const event = {
  providerId: "telnyx",
  eventId: "evt_1",
  eventType: "message.received",
  payload: { data: { id: "evt_1" } },
  businessId: "biz_1",
  signatureVerified: true,
};

beforeEach(() => {
  state.insertError = null;
  state.inserted = [];
  state.deleted = [];
});

describe("inbound webhook persistence classification", () => {
  it("treats a unique violation (23505) as a duplicate", async () => {
    state.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const result = await recordWebhookEvent(event);
    expect(result).toEqual({ duplicate: true, failed: false });
  });

  it("treats any other database error as a real failure, not a duplicate", async () => {
    state.insertError = { code: "57P01", message: "terminating connection due to administrator command" };
    const result = await recordWebhookEvent(event);
    expect(result.duplicate).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain("terminating connection");
  });

  it("records the event exactly once on success", async () => {
    const result = await recordWebhookEvent(event);
    expect(result).toEqual({ duplicate: false, failed: false });
    expect(state.inserted).toHaveLength(1);
  });

  it("classifies unique violations by code and by message text only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value" })).toBe(true);
    expect(isUniqueViolation({ code: "08006", message: "connection failure" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("route acknowledgement rules", () => {
  // Mirrors the route flow: persist -> (failed ? 503) -> (duplicate ? 200) -> process.
  async function handle(process: () => Promise<{ handled: boolean }>) {
    const { duplicate, failed } = await recordWebhookEvent(event);
    if (failed) return { status: 503, acknowledged: false };
    if (duplicate) return { status: 200, acknowledged: true, duplicate: true };
    try {
      const result = await process();
      return { status: result.handled ? 200 : 202, acknowledged: true };
    } catch {
      await releaseWebhookEvent(event.providerId, event.eventId);
      return { status: 503, acknowledged: false };
    }
  }

  it("returns a retryable failure when persistence fails transiently", async () => {
    state.insertError = { code: "40001", message: "could not serialize access" };
    await expect(handle(async () => ({ handled: true }))).resolves.toMatchObject({
      status: 503,
      acknowledged: false,
    });
  });

  it("does not acknowledge a processing failure and releases the event for retry", async () => {
    const outcome = await handle(async () => {
      throw new Error("database write failed mid-processing");
    });
    expect(outcome).toMatchObject({ status: 503, acknowledged: false });
    expect(state.deleted).toEqual([{ provider: "telnyx", eventId: "evt_1" }]);
  });

  it("keeps a valid duplicate event idempotent with a 200 acknowledgement", async () => {
    state.insertError = { code: "23505", message: "duplicate key value" };
    const processor = vi.fn(async () => ({ handled: true }));
    const outcome = await handle(processor);
    expect(outcome).toMatchObject({ status: 200, duplicate: true });
    expect(processor).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(0);
  });
});

describe("signature verification remains mandatory", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const rawBody = JSON.stringify({ data: { id: "evt_1" } });
  const timestamp = String(Math.floor(Date.now() / 1000));

  function headers(signature: string) {
    return new Headers({
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    });
  }

  it("accepts a correctly signed payload", async () => {
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");
    const result = await verifyTelnyxSignature({
      headers: headers(signature),
      rawBody,
      publicKeyBase64,
    });
    expect(result.verified).toBe(true);
  });

  it("rejects a tampered signature and a tampered body", async () => {
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");
    await expect(
      verifyTelnyxSignature({ headers: headers("AAAA"), rawBody, publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: false });
    await expect(
      verifyTelnyxSignature({ headers: headers(signature), rawBody: `${rawBody} `, publicKeyBase64 }),
    ).resolves.toMatchObject({ verified: false });
  });
});
