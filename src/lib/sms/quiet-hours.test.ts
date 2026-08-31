import { describe, expect, it, vi } from "vitest";
import { evaluateQuietHoursGate, QUIET_HOURS_BLOCKED_CODE } from "./quiet-hours";

const SYDNEY = { timezone: "Australia/Sydney", quiet_hours_start: 20, quiet_hours_end: 8 };
const PERTH = { timezone: "Australia/Perth", quiet_hours_start: 20, quiet_hours_end: 8 };

describe("quiet-hours gate (pure)", () => {
  it("blocks inside the configured window", () => {
    const gate = evaluateQuietHoursGate(SYDNEY, new Date("2026-08-31T12:00:00Z")); // 22:00 Sydney
    expect(gate.blocked).toBe(true);
    if (gate.blocked) expect(gate.code).toBe(QUIET_HOURS_BLOCKED_CODE);
  });

  it("allows outside the configured window", () => {
    expect(evaluateQuietHoursGate(SYDNEY, new Date("2026-08-31T03:00:00Z")).blocked).toBe(false); // 13:00
  });

  it("uses the tenant timezone, never a hardcoded zone", () => {
    const at = new Date("2026-08-31T12:00:00Z"); // 22:00 Sydney, 20:00 Perth
    expect(evaluateQuietHoursGate(SYDNEY, at).blocked).toBe(true);
    expect(evaluateQuietHoursGate(PERTH, at).blocked).toBe(true);
    const morning = new Date("2026-08-31T00:30:00Z"); // 10:30 Sydney, 08:30 Perth
    expect(evaluateQuietHoursGate(SYDNEY, morning).blocked).toBe(false);
    expect(evaluateQuietHoursGate(PERTH, morning).blocked).toBe(false);
    const early = new Date("2026-08-30T23:30:00Z"); // 09:30 Sydney, 07:30 Perth
    expect(evaluateQuietHoursGate(SYDNEY, early).blocked).toBe(false);
    expect(evaluateQuietHoursGate(PERTH, early).blocked).toBe(true);
  });

  it("blocks at the quiet-hours start boundary", () => {
    const gate = evaluateQuietHoursGate(SYDNEY, new Date("2026-08-31T10:00:00Z")); // 20:00 Sydney
    expect(gate.blocked).toBe(true);
    expect(gate.localHour).toBe(20);
  });

  it("allows at the quiet-hours end boundary", () => {
    const gate = evaluateQuietHoursGate(SYDNEY, new Date("2026-08-30T22:00:00Z")); // 08:00 Sydney
    expect(gate.blocked).toBe(false);
    expect(gate.localHour).toBe(8);
  });

  it("does not change the configured window", () => {
    const settings = { ...SYDNEY };
    evaluateQuietHoursGate(settings, new Date("2026-08-31T12:00:00Z"));
    expect(settings).toEqual(SYDNEY);
  });
});

/**
 * Model of the outbound path in sendSms, in the implemented order: safety
 * checks -> idempotency read -> quiet-hours gate -> usage cap -> conversation ->
 * reservation -> carrier. A quiet-hours block must return before any of the
 * side-effecting steps.
 */
function createEngine(opts: {
  settings: typeof SYDNEY;
  now: string;
  carrier: ReturnType<typeof vi.fn> & (() => unknown);
}) {
  const messages: { id: string; businessId: string; key: string | null; status: string }[] = [];
  const conversations: string[] = [];
  const usage = { segments: 0 };
  const audits: { businessId: string; eventType: string }[] = [];
  let seq = 0;

  async function send(input: {
    businessId: string;
    leadId: string;
    kind: "manual" | "approved_reply" | "acknowledgement" | "follow_up";
    key?: string | null;
    optedOut?: boolean;
    suppressed?: boolean;
    invalid?: boolean;
  }) {
    if (input.optedOut) return { sent: false, reason: "opted out" };
    if (input.invalid) return { sent: false, reason: "invalid recipient" };
    const automated = input.kind === "acknowledgement" || input.kind === "follow_up";
    if (automated && input.suppressed) return { sent: false, reason: "suppressed" };

    const existing = input.key
      ? messages.find((m) => m.businessId === input.businessId && m.key === input.key)
      : undefined;
    if (existing && existing.status !== "failed")
      return { sent: false, duplicate: true, messageId: existing.id };

    const gate = evaluateQuietHoursGate(opts.settings, new Date(opts.now));
    if (gate.blocked) {
      audits.push({ businessId: input.businessId, eventType: "sms_blocked_quiet_hours" });
      return { sent: false, retriable: true, code: QUIET_HOURS_BLOCKED_CODE };
    }

    usage.segments += 1;
    conversations.push(input.leadId);
    const row = {
      id: `msg_${++seq}`,
      businessId: input.businessId,
      key: input.key ?? null,
      status: "queued",
    };
    messages.push(row);
    await opts.carrier();
    row.status = "sent";
    return { sent: true, messageId: row.id };
  }

  return { send, messages, conversations, usage, audits };
}

const KINDS = ["manual", "approved_reply", "acknowledgement", "follow_up"] as const;

describe("final send gate in the outbound path", () => {
  it.each(KINDS)("blocks %s during quiet hours with zero side effects", async (kind) => {
    const carrier = vi.fn();
    const engine = createEngine({ settings: SYDNEY, now: "2026-08-31T12:00:00Z", carrier });
    const result = await engine.send({ businessId: "biz_a", leadId: "lead_1", kind });

    expect(result.sent).toBe(false);
    expect(result.code).toBe(QUIET_HOURS_BLOCKED_CODE);
    expect(carrier).not.toHaveBeenCalled();
    expect(engine.usage.segments).toBe(0);
    expect(engine.messages).toHaveLength(0);
    expect(engine.conversations).toHaveLength(0);
    expect(engine.audits).toEqual([
      { businessId: "biz_a", eventType: "sms_blocked_quiet_hours" },
    ]);
  });

  it.each(KINDS)("still sends %s outside quiet hours", async (kind) => {
    const carrier = vi.fn().mockResolvedValue({ id: "p1" });
    const engine = createEngine({ settings: SYDNEY, now: "2026-08-31T03:00:00Z", carrier });
    const result = await engine.send({ businessId: "biz_a", leadId: "lead_1", kind });

    expect(result.sent).toBe(true);
    expect(carrier).toHaveBeenCalledTimes(1);
    expect(engine.usage.segments).toBe(1);
    expect(engine.messages).toHaveLength(1);
    expect(engine.conversations).toEqual(["lead_1"]);
  });

  it("does not bypass earlier safety checks", async () => {
    const carrier = vi.fn();
    const engine = createEngine({ settings: SYDNEY, now: "2026-08-31T12:00:00Z", carrier });
    const optedOut = await engine.send({
      businessId: "biz_a",
      leadId: "lead_1",
      kind: "manual",
      optedOut: true,
    });
    expect(optedOut.code).toBeUndefined();
    expect(engine.audits).toHaveLength(0);
    expect(carrier).not.toHaveBeenCalled();
  });

  it("does not consume or reuse an idempotency key when blocked", async () => {
    const carrier = vi.fn().mockResolvedValue({ id: "p1" });
    const blocked = createEngine({ settings: SYDNEY, now: "2026-08-31T12:00:00Z", carrier });
    await blocked.send({
      businessId: "biz_a",
      leadId: "lead_1",
      kind: "follow_up",
      key: "lead_1:follow_up:1",
    });
    expect(blocked.messages).toHaveLength(0);

    const open = createEngine({ settings: SYDNEY, now: "2026-08-31T03:00:00Z", carrier });
    const first = await open.send({
      businessId: "biz_a",
      leadId: "lead_1",
      kind: "follow_up",
      key: "lead_1:follow_up:1",
    });
    const second = await open.send({
      businessId: "biz_a",
      leadId: "lead_1",
      kind: "follow_up",
      key: "lead_1:follow_up:1",
    });
    expect(first.sent).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(carrier).toHaveBeenCalledTimes(1);
  });

  it("keeps tenant isolation for the gate decision and audit", async () => {
    const carrier = vi.fn();
    const engine = createEngine({ settings: SYDNEY, now: "2026-08-31T12:00:00Z", carrier });
    await engine.send({ businessId: "biz_b", leadId: "lead_2", kind: "manual" });
    expect(engine.audits.every((a) => a.businessId === "biz_b")).toBe(true);
    expect(carrier).not.toHaveBeenCalled();
  });
});
