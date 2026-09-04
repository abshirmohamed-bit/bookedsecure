import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIMABLE_STATUSES, LEDGER_STATUSES, isExecutable, type LedgerRow } from "./agent-ledger.server";

const source = readFileSync("src/lib/agent-ledger.server.ts", "utf8");
const gatesSource = readFileSync("src/lib/agent-gates.server.ts", "utf8");

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "action-1",
    business_id: "biz-1",
    lead_id: "lead-1",
    sequence_id: "contact_only_introduction",
    action_kind: "send_message",
    template_id: "contact_only_introduction_neutral",
    idempotency_key: "seq:biz-1:lead-1:contact_only_introduction:step1",
    mode: "live",
    status: "claimed",
    attempt_count: 1,
    max_attempts: 3,
    blocked_reason: null,
    failure_reason: null,
    result_ref: null,
    result_kind: null,
    campaign_id: "camp-1",
    activation_id: "act-1",
    rolled_back_at: null,
    ...overrides,
  };
}

describe("agent action ledger", () => {
  it("declares the full status vocabulary including non-destructive rollback", () => {
    expect(LEDGER_STATUSES).toEqual([
      "planned",
      "claimed",
      "succeeded",
      "blocked",
      "failed",
      "abandoned",
      "rolled_back",
    ]);
  });

  it("only allows claims from planned or failed — succeeded is terminal", () => {
    expect(CLAIMABLE_STATUSES).toEqual(["planned", "failed"]);
    expect(CLAIMABLE_STATUSES).not.toContain("succeeded");
    expect(CLAIMABLE_STATUSES).not.toContain("claimed");
    expect(CLAIMABLE_STATUSES).not.toContain("rolled_back");
    expect(CLAIMABLE_STATUSES).not.toContain("abandoned");
  });

  it("treats the conditional claim update as the lock", () => {
    expect(source).toContain('.in("status", CLAIMABLE_STATUSES');
    expect(source).toContain('.eq("mode", input.mode)');
    expect(source).toContain('.is("rolled_back_at", null)');
    expect(source).toContain('.eq("business_id", input.businessId)');
  });

  it("executes only a live claim of the expected kind", () => {
    expect(isExecutable(row(), "send_message")).toBe(true);
    expect(isExecutable(row(), "offer_booking")).toBe(false);
    expect(isExecutable(row({ status: "planned" }), "send_message")).toBe(false);
    expect(isExecutable(row({ status: "succeeded" }), "send_message")).toBe(false);
    expect(isExecutable(row({ mode: "dry_run" }), "send_message")).toBe(false);
    expect(isExecutable(row({ rolled_back_at: "now" }), "send_message")).toBe(false);
  });

  it("records previews in dry_run mode only", () => {
    expect(source).toContain('mode: "dry_run"');
    expect(source).toContain("recordPlanPreview");
  });

  it("makes replay a no-op: an existing row is returned untouched", () => {
    expect(source).toContain("if (existing) return existing;");
    // Unique key is (business_id, mode, idempotency_key); the loser of a race reads the winner.
    expect(source).toContain("A concurrent insert loses the unique race");
  });

  it("never deletes ledger, message, booking, job or audit history", () => {
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\btruncate\b/i);
    expect(source).not.toContain("current_sequence");
  });

  it("rollback marks rows with reason, actor, time and activation, and writes an audit event", () => {
    expect(source).toContain("rolled_back_at: new Date().toISOString()");
    expect(source).toContain("rollback_reason: input.reason");
    expect(source).toContain("rollback_actor: input.actorUserId");
    expect(source).toContain('.eq("activation_id", input.activationId)');
    expect(source).toContain('event_type: "agent_activation_rolled_back"');
    // Succeeded actions keep their outcome; rollback never rewrites what happened.
    expect(source).toContain('.neq("status", "succeeded")');
  });

  it("never sends, enqueues, books or notifies from the ledger", () => {
    for (const forbidden of [
      "sendSms",
      "enqueueJob",
      "createNotification",
      "commitWebChatBooking",
      "sendSlotOffer",
      "fetch(",
      "telnyx",
      "twilio",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("keeps gate loading read-only and server-authoritative", () => {
    for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "sendSms", "enqueueJob", "fetch("]) {
      expect(gatesSource).not.toContain(forbidden);
    }
    // The requested mode is advisory input only; the decision comes from gates.
    expect(gatesSource).toContain("requestedMode: input.requestedMode");
    // Gate failures are evaluated from server-verified facts and handed
    // straight to the mode resolver.
    expect(gatesSource).toContain("evaluateActivationGates({");
    expect(gatesSource).toContain("serverVerifiedGateFailures: gateFailures");
  });
});
