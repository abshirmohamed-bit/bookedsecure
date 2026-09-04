import { describe, expect, it } from "vitest";

import { evaluateActivationGates } from "../agent-gates";
import { renderAgentMessage } from "../agent-templates";
import { createSandboxAdapters, SandboxIsolationError, assertSandboxIsolation } from "./adapters";
import { SANDBOX_SCENARIOS, SANDBOX_TENANT_ID, findScenario } from "./scenarios";
import {
  createSandboxRun,
  runSandboxSuite,
  sandboxEligibility,
  sandboxGateFacts,
  sandboxPlan,
} from "./runner";

const record = (scenarioId: string) => {
  const fixture = findScenario(scenarioId)!;
  return createSandboxRun().execute(fixture);
};

describe("sandbox scenario coverage", () => {
  it("covers all eighteen required scenarios", () => {
    expect(SANDBOX_SCENARIOS).toHaveLength(18);
    expect(new Set(SANDBOX_SCENARIOS.map((s) => s.scenarioId)).size).toBe(18);
  });

  it("returns the expected explicit outcome per scenario", () => {
    const { records } = runSandboxSuite();
    const byId = Object.fromEntries(records.map((r) => [r.trace.scenarioId, r.outcome]));
    expect(byId["S01_fresh_website_lead_consented"]).toBe("SANDBOX_ELIGIBLE");
    expect(byId["S02_crm_import_no_consent"]).toBe("SANDBOX_BLOCKED_CONSENT");
    expect(byId["S03_opted_out"]).toBe("SANDBOX_BLOCKED_CONSENT");
    expect(byId["S04_suppressed"]).toBe("SANDBOX_BLOCKED_REACHABILITY");
    expect(byId["S05_owner_review_required"]).toBe("SANDBOX_BLOCKED_OWNER_REVIEW");
    expect(byId["S06_existing_booking"]).toBe("SANDBOX_BLOCKED_BOOKING");
    expect(byId["S07_prior_outbound_sms"]).toBe("SANDBOX_BLOCKED_DUPLICATE");
    expect(byId["S08_quiet_hours"]).toBe("SANDBOX_BLOCKED_QUIET_HOURS");
    expect(byId["S09_over_cap"]).toBe("SANDBOX_BLOCKED_CAP");
    expect(byId["S10_unknown_reachability"]).toBe("SANDBOX_BLOCKED_REACHABILITY");
    expect(byId["S11_approved_listed_service"]).toBe("SANDBOX_ELIGIBLE");
    expect(byId["S12_unlisted_service"]).toBe("SANDBOX_BLOCKED_STATE_INCONSISTENCY");
    expect(byId["S13_retry_same_intent"]).toBe("SANDBOX_BLOCKED_DUPLICATE");
    expect(byId["S14_duplicate_provider_event"]).toBe("SANDBOX_BLOCKED_DUPLICATE");
    expect(byId["S17_booking_commit_failure"]).toBe("SANDBOX_BLOCKED_STATE_INCONSISTENCY");
  });

  it("traces every run to tenant, run, scenario, fixture, mode and timestamp", () => {
    const { records } = runSandboxSuite({ testRunId: "run-42", createdAt: "2026-09-04T11:00:00.000Z" });
    for (const r of records) {
      expect(r.trace).toMatchObject({
        tenantId: SANDBOX_TENANT_ID,
        testRunId: "run-42",
        executionMode: "sandbox",
        createdAt: "2026-09-04T11:00:00.000Z",
      });
      expect(r.trace.scenarioId).toBeTruthy();
      expect(r.trace.leadFixtureId).toMatch(/^fixture-/);
    }
  });

  it("captures every required recorder field for an eligible lead", () => {
    const r = record("S01_fresh_website_lead_consented");
    expect(r.outcome).toBe("SANDBOX_ELIGIBLE");
    expect(r.renderedSms).toBeTruthy();
    expect(r.sequenceId).toBeTruthy();
    expect(r.templateId).toBeTruthy();
    expect(r.templateVersion).toBe(1);
    expect(r.substitutions.length).toBeGreaterThan(0);
    for (const s of r.substitutions) expect(s.source).toMatch(/^(leads|businesses|approved_services|booking_offers)\./);
    expect(r.segments).toBeGreaterThan(0);
    expect(r.messageSource).toBe("agent_automation");
    expect(r.idempotencyKey).toContain(SANDBOX_TENANT_ID);
    expect(r.intendedRecipient).toBe("+61400000001");
    expect(r.gatesPassed.length).toBeGreaterThan(0);
    expect(r.gatesFailed).toEqual([]);
    expect(r.suppressionCheck.blocked).toBe(false);
    expect(r.quietHours.blocked).toBe(false);
    expect(r.capEvaluation.blocked).toBe(false);
    expect(r.ownerReview.blocked).toBe(false);
    expect(r.wouldSend).toBe(true);
    expect(r.didSend).toBe(false);
    expect(r.attribution).toEqual({
      sequence_id: r.sequenceId,
      template_id: r.templateId,
      agent_action_id: null,
    });
  });
});

describe("sandbox / production parity", () => {
  it("makes the same eligibility decision as production for identical state", () => {
    for (const fixture of SANDBOX_SCENARIOS) {
      const sandbox = sandboxEligibility(fixture);
      const { plan } = sandboxPlan(fixture);
      const production = evaluateActivationGates(sandboxGateFacts(fixture, plan));
      expect(sandbox.failures).toEqual(production);
      expect(sandbox.eligible).toBe(production.length === 0);
    }
  });

  it("records the exact production message without sending it", () => {
    const r = record("S11_approved_listed_service");
    const production = renderAgentMessage(r.templateId!, {
      leadName: "Sandbox Lead",
      businessName: "Sandbox Detailing (test tenant)",
      approvedServiceName: "Full Interior Detail",
      bookingLink: "https://sandbox.invalid/quote/sandbox",
      slotLabels: ["Tue 9:00 am", "Tue 12:00 pm"],
    });
    expect(r.renderedSms).toBe(production.body);
    expect(r.segments).toBe(production.segmentInfo.segments);
    expect(r.didSend).toBe(false);
  });
});

describe("sandbox booking behaviour", () => {
  it("accepts a fake calendar slot without creating a real offer or job", () => {
    const r = record("S15_booking_accepted");
    expect(r.calendarSlot?.selected?.id).toBe("fake-slot-1");
    expect(r.bookingDecision?.allowed).toBe(true);
    // "Would create" only — no writer is reachable from the sandbox.
    expect(r.wouldCreateJob).toBe(true);
    expect(r.didSend).toBe(false);
  });

  it("records a declined booking with no slot and no job", () => {
    const r = record("S16_booking_declined");
    expect(r.calendarSlot?.declined).toBe(true);
    expect(r.wouldCreateJob).toBe(false);
  });

  it("records a commit failure as a state inconsistency and creates nothing", () => {
    const r = record("S17_booking_commit_failure");
    expect(r.bookingDecision?.allowed).toBe(false);
    expect(r.bookingDecision?.reason).toBe("slot_unavailable");
    expect(r.outcome).toBe("SANDBOX_BLOCKED_STATE_INCONSISTENCY");
    expect(r.wouldCreateJob).toBe(false);
  });

  it("treats a commit retry as the same intent", () => {
    const run = createSandboxRun();
    const first = run.execute(findScenario("S17_booking_commit_failure")!);
    const retry = run.execute(findScenario("S18_booking_commit_retry")!);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.duplicateSuppressed).toBe(true);
    expect(retry.wouldSend).toBe(false);
  });
});

describe("sandbox idempotency", () => {
  it("is idempotent when the same intent is re-run", () => {
    const run = createSandboxRun();
    const fixture = findScenario("S01_fresh_website_lead_consented")!;
    const first = run.execute(fixture);
    const second = run.execute(fixture);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.wouldSend).toBe(true);
    expect(second.wouldSend).toBe(false);
    expect(second.outcome).toBe("SANDBOX_BLOCKED_DUPLICATE");
    expect(run.adapters.sms.seenKeys()).toHaveLength(1);
  });

  it("suppresses a duplicate provider event", () => {
    const r = record("S14_duplicate_provider_event");
    expect(r.duplicateSuppressed).toBe(true);
    expect(r.wouldSend).toBe(false);
  });
});

describe("sandbox isolation and tenancy", () => {
  it("never marks anything as sent", () => {
    const { run } = runSandboxSuite();
    for (const entry of run.recordedSms()) expect(entry.sent).toBe(false);
    for (const note of run.adapters.notifications.entries()) expect(note.sent).toBe(false);
  });

  it("keeps every artefact on the sandbox tenant with synthetic fixture leads", () => {
    const { records, run } = runSandboxSuite();
    for (const r of records) expect(r.trace.tenantId).toBe(SANDBOX_TENANT_ID);
    for (const entry of run.recordedSms()) {
      expect(entry.trace.tenantId).toBe(SANDBOX_TENANT_ID);
      expect(entry.trace.leadFixtureId).toMatch(/^fixture-/);
      expect(entry.trace.executionMode).toBe("sandbox");
    }
  });

  it("refuses a cross-tenant fixture", () => {
    const run = createSandboxRun();
    const fixture = {
      ...findScenario("S01_fresh_website_lead_consented")!,
      gateOverrides: { businessId: "11111111-1111-1111-1111-111111111111" },
    };
    expect(() => run.execute(fixture)).toThrow(/tenant isolation/i);
  });

  it("hard-asserts that adapters cannot reach live paths", () => {
    const adapters = createSandboxAdapters();
    expect(adapters.sms.canReachProvider).toBe(false);
    expect(adapters.calendar.canWriteBookings).toBe(false);
    expect(adapters.notifications.canReachProductionNotifications).toBe(false);
    expect(() =>
      assertSandboxIsolation({ ...adapters, executionMode: "live" as never }),
    ).toThrow(SandboxIsolationError);
    expect(() =>
      assertSandboxIsolation({ ...adapters, sms: { ...adapters.sms, canReachProvider: true as never } }),
    ).toThrow(SandboxIsolationError);
    expect(() =>
      assertSandboxIsolation({
        ...adapters,
        calendar: { ...adapters.calendar, canWriteBookings: true as never },
      }),
    ).toThrow(SandboxIsolationError);
    expect(() =>
      assertSandboxIsolation({
        ...adapters,
        notifications: {
          ...adapters.notifications,
          canReachProductionNotifications: true as never,
        },
      }),
    ).toThrow(SandboxIsolationError);
  });
});
