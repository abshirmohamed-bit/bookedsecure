// Phase 4 (step 3) boundary proofs: tenant scoping, no-create-on-request, and
// the set of ledger states that can never execute. Behavioural assertions run
// through the pure decision core; scoping assertions are static source guards
// over the only two modules that touch the database on this path.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideExecution, type ExecutorInput } from "./agent-executor";
import {
  evaluateActivationGates,
  resolveExecutionMode,
  type GateFacts,
} from "./agent-gates";
import { CLAIMABLE_STATUSES, LEDGER_STATUSES, isExecutable, type LedgerRow } from "./agent-ledger.server";
import type { PlannedAction, SequencePlan } from "./sequence-actions";

const B = "biz-1";
const L = "lead-1";
const SEQ = "contact_only_introduction";
const KEY = `seq:${B}:${L}:${SEQ}:step1`;

const ledgerSource = readFileSync("src/lib/agent-ledger.server.ts", "utf8");
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

const gateResult = (overrides: Partial<GateFacts> = {}) =>
  resolveExecutionMode({
    requestedMode: "live",
    serverVerifiedGateFailures: evaluateActivationGates(passingFacts(overrides)),
  });

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

const replan: SequencePlan = {
  mode: "dry_run",
  businessId: B,
  leadId: L,
  sequence: SEQ as SequencePlan["sequence"],
  decision: { sequence: SEQ } as unknown as SequencePlan["decision"],
  actions: [action],
  blockedReasons: [],
  wouldSend: false,
};

function input(overrides: Partial<ExecutorInput> = {}): ExecutorInput {
  return {
    businessId: B,
    leadId: L,
    ledgerRow: ledger(),
    claimHeld: true,
    plannedAction: action,
    replan,
    plannedBookingStatus: "none",
    currentBookingStatus: "none",
    gateResult: gateResult(),
    ...overrides,
  };
}

describe("tenant scoping of every lookup on the execution path", () => {
  it("scopes every ledger read and write by business_id", () => {
    // Every supabase call chain in the ledger must carry a business filter.
    const chains = ledgerSource.split(/\.from\("agent_actions"\)/).slice(1);
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      const head = chain.slice(0, chain.indexOf(";"));
      // Reads/updates filter on business_id; the single insert carries it in the payload.
      expect(head).toMatch(/\.eq\("business_id",|business_id: input\.businessId/);
    }
  });

  it("scopes the ledger lookup by business, mode and idempotency key", () => {
    expect(ledgerSource).toContain('.eq("business_id", input.businessId)');
    expect(ledgerSource).toContain('.eq("mode", input.mode)');
    expect(ledgerSource).toContain('.eq("idempotency_key", input.idempotencyKey)');
  });

  it("scopes the executor's live lead lookup by both lead id and business id", () => {
    const leadRead = executorServerSource.slice(executorServerSource.indexOf('.from("leads")'));
    const head = leadRead.slice(0, leadRead.indexOf("maybeSingle"));
    expect(head).toContain('.eq("id", input.leadId)');
    expect(head).toContain('.eq("business_id", input.businessId)');
  });

  it("reads no table other than the ledger and the lead on the execution path", () => {
    const tables = [...executorServerSource.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["leads"]));
  });
});

describe("an execution request never creates a ledger row", () => {
  it("the executor has no insert, upsert or record-planned-action call", () => {
    for (const forbidden of [".insert(", ".upsert(", "recordPlannedAction", "recordPlanPreview"]) {
      expect(executorServerSource).not.toContain(forbidden);
    }
  });

  it("a missing ledger action refuses instead of creating one", () => {
    const result = decideExecution(input({ ledgerRow: null }));
    expect(result.reason).toBe("unknown_action_reference");
    expect(result.actionId).toBeNull();
    expect(result.executed).toBe(false);
  });

  it("the only ledger row creator is the dry-run planner path, and it is idempotent", () => {
    expect(ledgerSource).toContain("if (existing) return existing;");
    const insertIndex = ledgerSource.indexOf(".insert(");
    expect(ledgerSource.indexOf("if (existing) return existing;")).toBeLessThan(insertIndex);
  });
});

describe("references that can never claim or execute", () => {
  const cases: [string, Partial<ExecutorInput>, string][] = [
    ["cross-tenant ledger row", { ledgerRow: ledger({ business_id: "biz-2" }) }, "cross_tenant_action_reference"],
    ["cross-lead ledger row", { ledgerRow: ledger({ lead_id: "lead-2" }) }, "action_lead_mismatch"],
    ["rolled-back row", { ledgerRow: ledger({ rolled_back_at: "2026-09-03T00:00:00Z" }) }, "action_rolled_back"],
    ["abandoned row", { ledgerRow: ledger({ status: "abandoned" }), claimHeld: false }, "claim_not_held"],
    ["already succeeded row", { ledgerRow: ledger({ status: "succeeded" }), claimHeld: false }, "claim_not_held"],
    ["blocked row", { ledgerRow: ledger({ status: "blocked" }), claimHeld: false }, "claim_not_held"],
    ["kill-switched tenant", { gateResult: gateResult({ tenantKillSwitchAt: "now" }) }, "gates_blocked"],
    ["kill-switched globally", { gateResult: gateResult({ globalKillSwitchAt: "now" }) }, "gates_blocked"],
  ];

  for (const [label, overrides, reason] of cases) {
    it(`refuses: ${label}`, () => {
      const result = decideExecution(input(overrides));
      expect(result.executed).toBe(false);
      expect(result.reason).toBe(reason);
    });
  }

  it("a dry-run ledger row is invisible to the live executor and unclaimable", () => {
    // The live lookup filters on mode, so a dry_run row resolves to null.
    expect(executorServerSource).toContain('mode: "live"');
    expect(decideExecution(input({ ledgerRow: null })).reason).toBe("unknown_action_reference");
    // And even if handed one directly, it is not executable.
    expect(isExecutable(ledger({ mode: "dry_run" }), "send_message")).toBe(false);
    // The claim update itself is mode-scoped.
    expect(ledgerSource).toContain('.eq("mode", input.mode)');
  });

  it("only planned or failed rows are claimable — every other status is not", () => {
    const nonClaimable = LEDGER_STATUSES.filter((s) => !CLAIMABLE_STATUSES.includes(s));
    expect(nonClaimable).toEqual(["claimed", "succeeded", "blocked", "abandoned", "rolled_back"]);
    for (const status of nonClaimable) {
      expect(isExecutable(ledger({ status }), "send_message")).toBe(status === "claimed");
    }
  });

  it("the claim update excludes rolled-back rows in SQL, not just in code", () => {
    expect(ledgerSource).toContain('.is("rolled_back_at", null)');
    expect(ledgerSource).toContain('.in("status", CLAIMABLE_STATUSES');
  });
});
