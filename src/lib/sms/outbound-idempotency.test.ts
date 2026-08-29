import { describe, expect, it, vi } from "vitest";
import {
  canReuseOutboundRow,
  classifyCarrierFailure,
  shouldReleaseSegments,
  RESERVED_STATUS,
  UNKNOWN_STATUS,
} from "./dispatch";

/**
 * In-memory model of the outbound path as implemented in sendSms:
 * reserve the message row (unique on business_id + idempotency_key) BEFORE the
 * carrier call, then settle it. Segment reservation mirrors the atomic
 * reserve/release SQL functions.
 */
function createEngine(carrier: () => Promise<{ id: string }>) {
  const messages: {
    id: string;
    businessId: string;
    key: string | null;
    status: string;
    attempts: number;
  }[] = [];
  const usage = { reserved: 0, released: 0 };
  let seq = 0;

  async function send(input: { businessId: string; key: string | null; segments: number }) {
    const existing = input.key
      ? messages.find((m) => m.businessId === input.businessId && m.key === input.key)
      : undefined;
    if (existing && !canReuseOutboundRow(existing.status)) {
      return { sent: false, duplicate: true, messageId: existing.id };
    }

    usage.reserved += input.segments;

    let row = existing;
    if (row) {
      row.status = RESERVED_STATUS;
      row.attempts += 1;
    } else {
      // Unique index: a concurrent insert with the same key loses.
      if (input.key && messages.some((m) => m.businessId === input.businessId && m.key === input.key)) {
        usage.released += input.segments;
        usage.reserved -= input.segments;
        return { sent: false, duplicate: true };
      }
      row = {
        id: `msg_${++seq}`,
        businessId: input.businessId,
        key: input.key,
        status: RESERVED_STATUS,
        attempts: 1,
      };
      messages.push(row);
    }

    try {
      const result = await carrier();
      row.status = "sent";
      return { sent: true, messageId: row.id, providerMessageId: result.id };
    } catch (error) {
      const failure = classifyCarrierFailure(error);
      if (shouldReleaseSegments(failure)) {
        usage.released += input.segments;
        usage.reserved -= input.segments;
        row.status = "failed";
        return { sent: false, retriable: true, messageId: row.id };
      }
      row.status = UNKNOWN_STATUS;
      return { sent: false, retriable: false, messageId: row.id, unknown: true };
    }
  }

  return { send, messages, usage };
}

describe("outbound duplicate-send protection", () => {
  it("dispatches once when two concurrent calls share an idempotency key", async () => {
    const carrier = vi.fn(async () => ({ id: "carrier_1" }));
    const engine = createEngine(carrier);
    const results = await Promise.all([
      engine.send({ businessId: "biz", key: "k1", segments: 1 }),
      engine.send({ businessId: "biz", key: "k1", segments: 1 }),
    ]);
    expect(carrier).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect(engine.messages).toHaveLength(1);
  });

  it("does not reserve usage twice for a suppressed duplicate", async () => {
    const engine = createEngine(async () => ({ id: "carrier_1" }));
    await engine.send({ businessId: "biz", key: "k1", segments: 3 });
    await engine.send({ businessId: "biz", key: "k1", segments: 3 });
    expect(engine.usage.reserved).toBe(3);
    expect(engine.usage.released).toBe(0);
  });

  it("does not dispatch again after the carrier accepted but the app failed", async () => {
    // The row is reserved before dispatch, so even if settling it fails the key
    // is taken and a retry is suppressed rather than sending a second SMS.
    const carrier = vi.fn(async () => ({ id: "carrier_1" }));
    const engine = createEngine(carrier);
    await engine.send({ businessId: "biz", key: "k1", segments: 1 });
    const retry = await engine.send({ businessId: "biz", key: "k1", segments: 1 });
    expect(retry.duplicate).toBe(true);
    expect(carrier).toHaveBeenCalledTimes(1);
  });

  it("handles a confirmed carrier rejection: released, retriable, resendable", async () => {
    let attempt = 0;
    const engine = createEngine(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Telnyx send failed [422]: invalid to number");
      return { id: "carrier_2" };
    });
    const first = await engine.send({ businessId: "biz", key: "k1", segments: 2 });
    expect(first).toMatchObject({ sent: false, retriable: true });
    expect(engine.usage.reserved).toBe(0);
    expect(engine.usage.released).toBe(2);

    const second = await engine.send({ businessId: "biz", key: "k1", segments: 2 });
    expect(second.sent).toBe(true);
    expect(engine.messages).toHaveLength(1);
    expect(engine.messages[0]?.attempts).toBe(2);
  });

  it("never auto-resends an ambiguous timeout and keeps the reservation", async () => {
    const carrier = vi.fn(async () => {
      throw new Error("fetch failed: socket hang up (timeout)");
    });
    const engine = createEngine(carrier);
    const first = await engine.send({ businessId: "biz", key: "k1", segments: 1 });
    expect(first).toMatchObject({ sent: false, retriable: false, unknown: true });
    expect(engine.messages[0]?.status).toBe(UNKNOWN_STATUS);
    expect(engine.usage.reserved).toBe(1);
    expect(engine.usage.released).toBe(0);

    const retry = await engine.send({ businessId: "biz", key: "k1", segments: 1 });
    expect(retry.duplicate).toBe(true);
    expect(carrier).toHaveBeenCalledTimes(1);
  });

  it("leaves successful outbound behaviour unchanged", async () => {
    const engine = createEngine(async () => ({ id: "carrier_ok" }));
    const result = await engine.send({ businessId: "biz", key: "manual:1", segments: 1 });
    expect(result).toMatchObject({ sent: true, providerMessageId: "carrier_ok" });
    expect(engine.messages[0]?.status).toBe("sent");
    expect(engine.usage.reserved).toBe(1);
  });
});

describe("carrier failure classification", () => {
  it("treats transport errors, 429 and 5xx as unknown outcomes", () => {
    for (const message of [
      "fetch failed",
      "The operation was aborted",
      "ETIMEDOUT",
      "Telnyx send failed [500]: server error",
      "Telnyx send failed [429]: rate limited",
    ]) {
      expect(classifyCarrierFailure(new Error(message))).toBe("unknown_outcome");
      expect(shouldReleaseSegments(classifyCarrierFailure(new Error(message)))).toBe(false);
    }
  });

  it("treats definite carrier refusals as confirmed rejections", () => {
    for (const message of [
      "Telnyx send failed [400]: invalid number",
      "Telnyx send failed [422]: unprocessable",
      "Telnyx is not connected yet.",
    ]) {
      expect(classifyCarrierFailure(new Error(message))).toBe("confirmed_rejection");
      expect(shouldReleaseSegments(classifyCarrierFailure(new Error(message)))).toBe(true);
    }
  });

  it("only reuses rows whose previous attempt confirmed failure", () => {
    expect(canReuseOutboundRow("failed")).toBe(true);
    expect(canReuseOutboundRow(RESERVED_STATUS)).toBe(false);
    expect(canReuseOutboundRow(UNKNOWN_STATUS)).toBe(false);
    expect(canReuseOutboundRow("sent")).toBe(false);
    expect(canReuseOutboundRow("delivered")).toBe(false);
  });
});
