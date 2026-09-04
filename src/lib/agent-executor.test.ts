import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISPATCHABLE_ACTION_KINDS,
  LIVE_EXECUTION_ENABLED,
  REFUSAL_REASONS,
  decideExecution,
  executionWouldDispatch,
  type ExecutorInput,
} from "./agent-executor";
import {
  evaluateActivationGates,
  resolveExecutionMode,
  type GateFacts,
  type GateId,
} from "./agent-gates";
import { CLAIMABLE_STATUSES, type LedgerRow } from "./agent-ledger.server";
import type { PlannedAction, SequencePlan } from "./sequence-actions";

const B = "biz-1";
const L = "lead-1";
const SEQ = "contact_only_introduction";
const KEY = `seq:${B}:${L}:${SEQ}:step1`;

const executorSource = readFileSync("src/lib/agent-executor.ts", "utf8");
const executorServerSource = readFileSync("src/lib/agent-executor.server.ts", "utf8");

function passingFacts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    actionKind: "send_message",
    businessId: B,
    leadBusinessId: B,
    campaignBusinessId: B,
    tenantOptedInAt: "2026-09-01T00:00:00Z",
    agentEnabled: true,
    tenantKillSwitchAt: null,
    globalKillSwitchAt: null,
    campaignStatus: "authorised",
    campaignDisabledAt: null,
    campaignApprovedAt: "2026-09-01T00:00:00Z",
    sequenceApprovedAt: "2026-09-01T00:00:00Z",
    campaignSequenceId: SEQ,
    plannedSequenceId: SEQ,
    approvedTemplateVersion: 1,
    plannedTemplateVersion: 1,
    scopeLeadIds: [L],
    leadId: L,
    executionAuthorisedAt: "2026-09-02T00:00:00Z",
    executionAuthorisationKind: "canary",
    requiresOwnerReview: false,
    consentGranted: true,
    consentCaptureAction: false,
    consentDeclined: false,
    optedOut: false,
    suppressed: false,
    reachable: true,
    tenantTakeover: false,
    automationPaused: false,
    hasConflictingBooking: false,
    quietHoursNow: false,
    sentToday: 0,
    dailySendCap: 5,
    sentThisHour: 0,
    hourlySendCap: 2,
    leadsInActivation: 1,
    maxLeadsPerActivation: 1,
    planStillCurrent: true,
    ...overrides,
  };
}

function gateResult(overrides: Partial<GateFacts> = {}) {
  return resolveExecutionMode({
    requestedMode: "live",
    serverVerifiedGateFailures: evaluateActivationGates(passingFacts(overrides)),
  });
}

const action: PlannedAction = {
  kind: "send_message",
  tool: "sendSms",
  templateId: "contact_only_introduction_neutral",
  offsetMinutes: 0,
  idempotencyKey: KEY,
  preconditions: ["consent_granted"],
  eligible: true,
  blockedReason: null,
  neutralLanguageRequired: true,
  wouldSend: false,
};

function ledger(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "action-1",
    business_id: B,
    lead_id: L,
    sequence_id: SEQ,
    action_kind: "send_message",
    template_id: "contact_only_introduction_neutral",
    idempotency_key: KEY,
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

function replan(overrides: Partial<SequencePlan> = {}): SequencePlan {
  return {
    mode: "dry_run",
    businessId: B,
    leadId: L,
    sequence: SEQ as SequencePlan["sequence"],
    decision: { sequence: SEQ } as unknown as SequencePlan["decision"],
    actions: [action],
    blockedReasons: [],
    wouldSend: false,
    ...overrides,
  };
}

function input(overrides: Partial<ExecutorInput> = {}): ExecutorInput {
  return {
    businessId: B,
    leadId: L,
    ledgerRow: ledger(),
    claimHeld: true,
    plannedAction: action,
    replan: replan(),
    plannedBookingStatus: "none",
    currentBookingStatus: "none",
    gateResult: gateResult(),
    ...overrides,
  };
}

describe("agent executor (step 3: live execution disabled)", () => {
  it("never executes, even when every gate passes and the claim is held", () => {
    const result = decideExecution(input());
    expect(LIVE_EXECUTION_ENABLED).toBe(false);
    expect(result).toMatchObject({
      executed: false,
      blocked: true,
      reason: "live_execution_disabled",
      mode: "live",
    });
    expect(result.gateFailures).toEqual([]);
    expect(executionWouldDispatch(result)).toBe(false);
  });

  it("exposes a stable refusal vocabulary and no booking-confirm action kind", () => {
    expect(new Set(REFUSAL_REASONS).size).toBe(REFUSAL_REASONS.length);
    expect(DISPATCHABLE_ACTION_KINDS).not.toContain("booking_confirm" as never);
    expect(executorSource).not.toContain("booking_confirm");
    expect(executorServerSource).not.toContain("booking_confirm");
  });

  const gateCases: [string, Partial<GateFacts>, GateId][] = [
    ["tenant opt-in alone is not enough", { tenantOptedInAt: null }, "tenant_opt_in"],
    ["agent disabled", { agentEnabled: false }, "agent_enabled"],
    ["global kill switch", { globalKillSwitchAt: "now" }, "global_kill_switch"],
    ["tenant kill switch", { tenantKillSwitchAt: "now" }, "tenant_kill_switch"],
    ["campaign not approved", { campaignApprovedAt: null }, "campaign_approved"],
    ["sequence not approved", { sequenceApprovedAt: null }, "sequence_approved"],
    ["template version drift", { plannedTemplateVersion: 2 }, "template_version_approved"],
    ["no explicit lead scope", { scopeLeadIds: [] }, "lead_scope"],
    ["lead outside scope", { scopeLeadIds: ["other"] }, "lead_scope"],
    ["no execution authorisation", { executionAuthorisedAt: null }, "execution_authorisation"],
    ["owner review", { requiresOwnerReview: true }, "lead_eligibility"],
    ["tenant takeover", { tenantTakeover: true }, "tenant_takeover"],
    ["automation paused", { automationPaused: true }, "automation_paused"],
    ["opted out", { optedOut: true }, "opt_out"],
    ["suppressed", { suppressed: true }, "suppression"],
    ["consent missing", { consentGranted: false }, "consent"],
    ["consent declined", { consentDeclined: true }, "consent"],
    ["unreachable", { reachable: false }, "reachability"],
    ["quiet hours", { quietHoursNow: true }, "quiet_hours"],
    ["booking conflict", { hasConflictingBooking: true, actionKind: "offer_booking" }, "booking_conflict"],
    ["daily cap", { sentToday: 5 }, "daily_volume_limit"],
    ["hourly cap", { sentThisHour: 2 }, "hourly_rate_limit"],
    ["activation lead cap", { leadsInActivation: 9 }, "activation_lead_cap"],
    ["stale plan", { planStillCurrent: false }, "plan_freshness"],
    ["cross-tenant lead", { leadBusinessId: "biz-2" }, "tenant_scope"],
    ["cross-tenant campaign", { campaignBusinessId: "biz-2" }, "tenant_scope"],
  ];

  for (const [label, override, gate] of gateCases) {
    it(`blocks execution independently: ${label}`, () => {
      const result = decideExecution(input({ gateResult: gateResult(override) }));
      expect(result.executed).toBe(false);
      expect(result.reason).toBe("gates_blocked");
      expect(result.mode).toBe("dry_run");
      expect(result.gateFailures.map((f) => f.gate)).toContain(gate);
    });
  }

  it("quiet hours defer rather than drop: the action stays planned with its tool recorded", () => {
    const result = decideExecution(input({ gateResult: gateResult({ quietHoursNow: true }) }));
    expect(result.gateFailures.find((f) => f.gate === "quiet_hours")?.detail).toContain("defer");
    expect(result.wouldInvokeTool).toBe("sendSms");
  });

  it("rejects invalid and cross-tenant action references", () => {
    expect(decideExecution(input({ ledgerRow: null })).reason).toBe("unknown_action_reference");
    expect(decideExecution(input({ ledgerRow: ledger({ business_id: "biz-2" }) })).reason).toBe(
      "cross_tenant_action_reference",
    );
    expect(decideExecution(input({ ledgerRow: ledger({ lead_id: "lead-2" }) })).reason).toBe(
      "action_lead_mismatch",
    );
    expect(decideExecution(input({ ledgerRow: ledger({ action_kind: "offer_booking" }) })).reason).toBe(
      "action_kind_mismatch",
    );
    expect(decideExecution(input({ ledgerRow: ledger({ rolled_back_at: "now" }) })).reason).toBe(
      "action_rolled_back",
    );
  });

  it("rejects stale plans, sequence changes and booking-state changes", () => {
    expect(decideExecution(input({ replan: null })).reason).toBe("plan_missing");
    expect(
      decideExecution(
        input({ replan: replan({ sequence: "previous_customer_reactivation" as SequencePlan["sequence"] }) }),
      ).reason,
    ).toBe("plan_stale_sequence");
    expect(decideExecution(input({ replan: replan({ actions: [] }) })).reason).toBe("plan_stale_action");
    expect(
      decideExecution(input({ replan: replan({ actions: [{ ...action, eligible: false }] }) })).reason,
    ).toBe("plan_stale_action");
    expect(decideExecution(input({ currentBookingStatus: "scheduled" })).reason).toBe(
      "plan_stale_booking_state",
    );
  });

  it("requires an atomically held claim", () => {
    expect(decideExecution(input({ claimHeld: false })).reason).toBe("claim_not_held");
    expect(
      decideExecution(input({ ledgerRow: ledger({ status: "planned" }) })).reason,
    ).toBe("action_not_claimable");
  });

  it("treats the conditional ledger update as the lock: duplicate claims win once", () => {
    // Simulates the `.in(status, CLAIMABLE_STATUSES)` conditional update.
    let status = "planned";
    const claim = () => {
      if (!CLAIMABLE_STATUSES.includes(status as never)) return false;
      status = "claimed";
      return true;
    };
    const first = claim();
    const second = claim();
    expect(first).toBe(true);
    expect(second).toBe(false);
    // The loser must stop: no second executable outcome exists.
    const loser = decideExecution(input({ claimHeld: false, ledgerRow: ledger({ status: "claimed" }) }));
    expect(loser.executed).toBe(false);
    expect(loser.reason).toBe("claim_not_held");
  });
});

describe("step 3 static guards", () => {
  it("hard-codes the live switch off and never reads it from caller input", () => {
    expect(executorSource).toContain("export const LIVE_EXECUTION_ENABLED = false as const;");
    for (const forbidden of ["LIVE_EXECUTION_ENABLED =true", "input.live", "input.enableLive"]) {
      expect(executorServerSource).not.toContain(forbidden);
    }
    // `requestedMode` is accepted but only ever forwarded to the gate loader.
    expect(executorServerSource).not.toContain('requestedMode === "live"');
  });

  it("contains no domain logic the executor must not duplicate", () => {
    for (const source of [executorSource, executorServerSource]) {
      for (const forbidden of [
        "quiet_hours_start",
        "evaluateQuietHoursGate",
        "STOP",
        "segments",
        "generateSlots",
        "loadAvailabilityConfig",
        "commitWebChatBooking",
        "notifications",
        "next_follow_up_at",
        "sendSms(",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("reaches no provider, send, enqueue, booking, notification or campaign write path", () => {
    for (const source of [executorSource, executorServerSource]) {
      for (const forbidden of [
        "fetch(",
        "telnyx",
        "sinch",
        ".insert(",
        ".delete(",
        "enqueueJob",
        "current_sequence",
        "automation_jobs",
        "booking_offers",
        "sequence_campaigns",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("gates every ledger write behind the disabled live switch", () => {
    // The only mutating ledger call is `claimAction`, inside `claimForExecution`,
    // which returns early while live execution is disabled.
    expect(executorServerSource.match(/claimAction\(/g)).toHaveLength(1);
    const guardIndex = executorServerSource.indexOf("if (!LIVE_EXECUTION_ENABLED) return false;");
    expect(guardIndex).toBeGreaterThan(0);
    expect(guardIndex).toBeLessThan(executorServerSource.indexOf("claimAction({"));
    for (const forbidden of ["completeAction", "blockAction", "failAction", ".update("]) {
      expect(executorServerSource).not.toContain(forbidden);
    }
  });

  it("keeps rollback non-destructive and owned by the ledger, not the executor", () => {
    expect(executorServerSource).not.toContain("rollbackActivation");
    const ledgerSource = readFileSync("src/lib/agent-ledger.server.ts", "utf8");
    expect(ledgerSource).toContain('status: "rolled_back"');
    expect(ledgerSource).not.toContain(".delete(");
  });
});
