import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookEventsMock } from "./webhook-events.mock";
import { CLAIM_TIMEOUT_MS } from "./dispatch-claim";

const store = createWebhookEventsMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => store.table() },
}));

const { recordWebhookEvent, markWebhookProcessed, markWebhookFailed } = await import(
  "./webhook.server"
);

const event = {
  providerId: "telnyx",
  eventId: "evt_state",
  eventType: "message.received",
  payload: { data: { id: "evt_state" } },
  businessId: "biz_1",
  signatureVerified: true,
};

/**
 * Route flow under test, including the side effects a real handler performs, so
 * duplicate/retry behaviour can be asserted on the effect counters.
 */
function createHandler() {
  const effects = { messages: 0, usage: 0, audits: 0, leads: 0 };
  const persisted = new Set<string>();

  async function handle(options: {
    signatureVerified?: boolean;
    fail?: boolean;
    messageId?: string;
  }) {
    if (options.signatureVerified === false) {
      // Rejected before any persistence at all.
      return { status: 401, rowsWritten: store.rows.length, effects };
    }
    const { duplicate, failed, state } = await recordWebhookEvent(event);
    if (failed) return { status: 503, state, effects };
    if (duplicate) {
      return state === "duplicate_in_progress"
        ? { status: 409, state, effects }
        : { status: 200, state, duplicate: true, effects };
    }
    try {
      const key = options.messageId ?? "in:msg_1";
      // Mirrors handleInboundMessage: message + usage + audit exactly once.
      if (!persisted.has(key)) {
        if (options.fail) throw new Error("usage write failed mid-processing");
        persisted.add(key);
        effects.messages += 1;
        effects.usage += 1;
        effects.audits += 1;
      }
      effects.leads += 1; // set-to-value update, idempotent by nature
      const marked = await markWebhookProcessed(event.providerId, event.eventId);
      if (!marked.ok) return { status: 503, state, effects };
      return { status: 200, state, effects };
    } catch (error) {
      await markWebhookFailed(event.providerId, event.eventId, error);
      return { status: 503, state, effects };
    }
  }

  return { handle, effects };
}

beforeEach(() => store.reset());

describe("durable webhook processing state", () => {
  it("processes a new event and stamps processed_at", async () => {
    const { handle } = createHandler();
    const outcome = await handle({});
    expect(outcome).toMatchObject({ status: 200, state: "claimed" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processed_at).toBeTruthy();
    expect(store.rows[0]?.processing_error).toBeNull();
    expect(outcome.effects).toMatchObject({ messages: 1, usage: 1, audits: 1 });
  });

  it("returns an already-processed duplicate safely without reprocessing", async () => {
    const { handle } = createHandler();
    await handle({});
    const replay = await handle({});
    expect(replay).toMatchObject({ status: 200, duplicate: true, state: "duplicate_processed" });
    // No second message, usage row or audit event.
    expect(replay.effects).toMatchObject({ messages: 1, usage: 1, audits: 1 });
    expect(store.rows).toHaveLength(1);
  });

  it("never acknowledges a concurrent duplicate while the first worker is active", async () => {
    // Fresh claim held by worker one.
    store.seed({ event_id: event.eventId, processing_started_at: new Date().toISOString() });
    const { handle } = createHandler();
    const outcome = await handle({});
    expect(outcome).toMatchObject({ status: 409, state: "duplicate_in_progress" });
    expect(outcome.status).not.toBe(200);
    expect(store.rows[0]?.processed_at).toBeNull();
  });

  it("leaves a processing failure retryable and reclaimable", async () => {
    const { handle } = createHandler();
    const failure = await handle({ fail: true });
    expect(failure.status).toBe(503);
    const row = store.rows[0]!;
    expect(row.processed_at).toBeNull();
    expect(row.processing_started_at).toBeNull();
    expect(row.processing_error).toContain("usage write failed");

    const retry = await handle({});
    expect(retry).toMatchObject({ status: 200, state: "reclaimed" });
    expect(store.rows[0]?.processed_at).toBeTruthy();
    expect(store.rows[0]?.processing_error).toBeNull();
  });

  it("completes a retry after failure without duplicating message, usage or audit", async () => {
    const handler = createHandler();
    // First attempt persists the message, then the mark-processed write fails.
    store.updateError = { code: "57P01", message: "connection terminated" };
    const first = await handler.handle({});
    expect(first.status).toBe(503);
    expect(handler.effects).toMatchObject({ messages: 1, usage: 1, audits: 1 });

    // Provider retries; the claim is stale so this delivery takes it over.
    store.updateError = null;
    store.rows[0]!.processing_started_at = new Date(Date.now() - CLAIM_TIMEOUT_MS - 1000).toISOString();
    const retry = await handler.handle({});
    expect(retry).toMatchObject({ status: 200, state: "reclaimed" });
    expect(handler.effects).toMatchObject({ messages: 1, usage: 1, audits: 1 });
    expect(store.rows).toHaveLength(1);
  });

  it("rejects an invalid signature before anything is persisted", async () => {
    const { handle } = createHandler();
    const outcome = await handle({ signatureVerified: false });
    expect(outcome.status).toBe(401);
    expect(store.rows).toHaveLength(0);
    expect(outcome.effects).toMatchObject({ messages: 0, usage: 0, audits: 0 });
  });

  it("returns non-2xx for a transient database failure on persistence", async () => {
    store.insertError = { code: "08006", message: "connection failure" };
    const { handle } = createHandler();
    const outcome = await handle({});
    expect(outcome.status).toBe(503);
    expect(store.rows).toHaveLength(0);
  });

  it("keeps a row alone from counting as successful processing", async () => {
    // Row exists, unprocessed, claim stale: must be reprocessed, not acknowledged.
    store.seed({
      event_id: event.eventId,
      processing_started_at: new Date(Date.now() - CLAIM_TIMEOUT_MS - 1000).toISOString(),
    });
    const result = await recordWebhookEvent(event);
    expect(result).toMatchObject({ duplicate: false, failed: false, state: "reclaimed" });
  });

  it("reports a failure when the event row cannot be read back", async () => {
    store.seed({ event_id: event.eventId });
    store.selectError = { code: "57P01", message: "terminating connection" };
    const result = await recordWebhookEvent(event);
    expect(result).toMatchObject({ duplicate: false, failed: true });
  });

  it("keeps inbound idempotency intact across repeated deliveries", async () => {
    const handler = createHandler();
    await handler.handle({ messageId: "in:msg_9" });
    await handler.handle({ messageId: "in:msg_9" });
    await handler.handle({ messageId: "in:msg_9" });
    expect(handler.effects).toMatchObject({ messages: 1, usage: 1, audits: 1 });
  });
});
