// Sandbox runner: production logic, recorder adapters, zero side effects.
//
// This module reaches for the SAME pure modules the live path uses:
//   selectSequence / planSequenceActions   (qualification + action planning)
//   evaluateActivationGates                (consent, owner review, caps, quiet
//                                           hours, suppression, booking, scope)
//   evaluateQuietHoursGate                 (quiet hours, tenant timezone)
//   renderAgentMessage + countSegments     (exact production SMS + segments)
//   assessOfferGeneration / assessBookingConfirmation (booking decision)
//   normaliseAgentAttribution              (message source attribution)
//
// It contains NO provider call, NO Supabase client, NO job enqueue, NO booking
// write, NO campaign activation and NO production notification. There is no
// I/O at all: the runner is pure and takes injected adapters.

import {
  GATE_IDS,
  evaluateActivationGates,
  type GateFacts,
  type GateFailure,
  type GateId,
} from "../agent-gates";
import { normaliseAgentAttribution } from "../agent-attribution";
import { renderAgentMessage, AGENT_TEMPLATE_VERSION } from "../agent-templates";
import { assessBookingConfirmation, assessOfferGeneration, type BookingDecision } from "../booking";
import { evaluateQuietHoursGate, type QuietHoursGate } from "../sms/quiet-hours";
import { planSequenceActions, type PlannedAction, type SequencePlan } from "../sequence-actions";
import { selectSequence, type SequenceDecision } from "../sequences";
import {
  assertSandboxIsolation,
  createSandboxAdapters,
  passedGates,
  SANDBOX_EXECUTION_MODE,
  type FakeCalendarSlot,
  type RecordedSms,
  type SandboxAdapters,
  type SandboxTrace,
} from "./adapters";
import {
  SANDBOX_BOOKING_LINK,
  SANDBOX_BUSINESS_NAME,
  SANDBOX_TENANT_ID,
  SANDBOX_TIMEZONE,
  SANDBOX_SCENARIOS,
  type SandboxFixture,
} from "./scenarios";

export const SANDBOX_OUTCOMES = [
  "SANDBOX_ELIGIBLE",
  "SANDBOX_BLOCKED_CONSENT",
  "SANDBOX_BLOCKED_OWNER_REVIEW",
  "SANDBOX_BLOCKED_REACHABILITY",
  "SANDBOX_BLOCKED_BOOKING",
  "SANDBOX_BLOCKED_QUIET_HOURS",
  "SANDBOX_BLOCKED_CAP",
  "SANDBOX_BLOCKED_DUPLICATE",
  "SANDBOX_BLOCKED_STATE_INCONSISTENCY",
] as const;
export type SandboxOutcome = (typeof SANDBOX_OUTCOMES)[number];

export type SandboxRecord = {
  trace: SandboxTrace;
  scenarioDescription: string;
  outcome: SandboxOutcome;
  eligibilityDecision: "eligible" | "blocked";
  /** Sequence + template identity, exactly as attributed in production. */
  sequenceId: SequenceDecision["sequence"];
  sequenceReason: string;
  templateId: PlannedAction["templateId"];
  templateVersion: number;
  actionKind: PlannedAction["kind"];
  intendedRecipient: string;
  renderedSms: string | null;
  substitutions: ReturnType<typeof renderAgentMessage>["substitutions"] | [];
  segments: number;
  messageSource: string;
  attribution: { sequence_id: string | null; template_id: string | null; agent_action_id: string | null };
  idempotencyKey: string;
  gatesPassed: readonly GateId[];
  gatesFailed: readonly GateFailure[];
  suppressionCheck: { suppressed: boolean; optedOut: boolean; stopKeywordSeen: boolean; blocked: boolean };
  quietHours: QuietHoursGate;
  capEvaluation: {
    sentToday: number;
    dailyCap: number;
    sentThisHour: number;
    hourlyCap: number;
    blocked: boolean;
  };
  ownerReview: { blocked: boolean; failures: readonly GateFailure[] };
  bookingDecision: (BookingDecision & { stage: string }) | null;
  calendarSlot: { selected: FakeCalendarSlot | null; declined: boolean } | null;
  wouldCreateJob: boolean;
  wouldSend: boolean;
  /** Always false. The recorder never contacts a carrier. */
  didSend: false;
  duplicateSuppressed: boolean;
  plan: SequencePlan;
};

export type SandboxRun = {
  trace: Omit<SandboxTrace, "scenarioId" | "leadFixtureId">;
  adapters: SandboxAdapters;
  execute(fixture: SandboxFixture): SandboxRecord;
  records(): readonly SandboxRecord[];
  recordedSms(): readonly RecordedSms[];
};

const OWNER_REVIEW_GATES: readonly GateId[] = [
  "owner_review",
  "lead_eligibility",
  "tenant_takeover",
  "automation_paused",
];
const CONSENT_GATES: readonly GateId[] = ["consent", "opt_out"];
const REACHABILITY_GATES: readonly GateId[] = ["reachability", "suppression"];
const CAP_GATES: readonly GateId[] = ["daily_volume_limit", "hourly_rate_limit", "activation_lead_cap"];
const STATE_GATES: readonly GateId[] = ["tenant_scope", "plan_freshness"];

/** Deterministic gate facts for a fixture. Nothing is read from the database. */
export function sandboxGateFacts(fixture: SandboxFixture, plan: SequencePlan): GateFacts {
  const action = firstMessagingAction(plan);
  const quiet = evaluateQuietHours(fixture);
  const facts: GateFacts = {
    actionKind: action?.kind ?? "record_audit",
    businessId: SANDBOX_TENANT_ID,
    leadBusinessId: SANDBOX_TENANT_ID,
    campaignBusinessId: SANDBOX_TENANT_ID,

    // Sandbox campaign state: fully approved so real eligibility logic is what
    // decides the outcome. This is a fixture, not a production activation.
    tenantOptedInAt: "2026-09-01T00:00:00.000Z",
    agentEnabled: true,
    tenantKillSwitchAt: null,
    globalKillSwitchAt: null,
    campaignStatus: "approved",
    campaignDisabledAt: null,
    campaignApprovedAt: "2026-09-01T00:00:00.000Z",
    sequenceApprovedAt: "2026-09-01T00:00:00.000Z",
    campaignSequenceId: plan.sequence,
    plannedSequenceId: plan.sequence,
    approvedTemplateVersion: AGENT_TEMPLATE_VERSION,
    plannedTemplateVersion: AGENT_TEMPLATE_VERSION,
    scopeLeadIds: [fixture.leadFixtureId],
    leadId: fixture.leadFixtureId,
    executionAuthorisedAt: "2026-09-01T00:00:00.000Z",
    executionAuthorisationKind: "canary",

    requiresOwnerReview: fixture.lead.requiresOwnerReview,
    consentGranted: fixture.lead.consentStatus === "granted",
    consentCaptureAction: action?.kind === "capture_consent",
    consentDeclined: fixture.lead.consentStatus === "declined",
    optedOut: fixture.lead.optedOut,
    suppressed: fixture.lead.suppressed,
    reachable: fixture.lead.reachable,
    tenantTakeover: false,
    automationPaused: false,
    hasConflictingBooking: false,
    quietHoursNow: quiet.blocked,

    sentToday: fixture.caps.sentToday,
    dailySendCap: fixture.caps.dailyCap,
    sentThisHour: fixture.caps.sentThisHour,
    hourlySendCap: fixture.caps.hourlyCap,
    leadsInActivation: 1,
    maxLeadsPerActivation: 1,

    planStillCurrent: true,
    nowIso: fixture.nowIso,
    ...fixture.gateOverrides,
  };
  return facts;
}

function evaluateQuietHours(fixture: SandboxFixture): QuietHoursGate {
  return evaluateQuietHoursGate(
    { timezone: SANDBOX_TIMEZONE, quiet_hours_start: 20, quiet_hours_end: 8 },
    new Date(fixture.nowIso),
  );
}

function firstMessagingAction(plan: SequencePlan): PlannedAction | null {
  return (
    plan.actions.find((a) => a.kind === "send_message" || a.kind === "capture_consent" || a.kind === "offer_booking") ??
    plan.actions[0] ??
    null
  );
}

/** Build the production plan for a fixture using the real planner. */
export function sandboxPlan(fixture: SandboxFixture): { decision: SequenceDecision; plan: SequencePlan } {
  const decision = selectSequence({
    leadContext: fixture.lead.leadContext,
    consentStatus: fixture.lead.consentStatus,
    bookingStatus: fixture.lead.bookingStatus,
    hasInboundReply: fixture.lead.hasInboundReply,
    hasBookingLink: true,
    agentEnabled: true,
  });
  const plan = planSequenceActions({
    decision,
    facts: {
      businessId: SANDBOX_TENANT_ID,
      leadId: fixture.leadFixtureId,
      leadBusinessId: SANDBOX_TENANT_ID,
      leadContext: fixture.lead.leadContext,
      quietHoursNow: evaluateQuietHours(fixture).blocked,
      hasBookingLink: true,
      bookableServiceValid: fixture.serviceIsListed,
      consentGranted: fixture.lead.consentStatus === "granted",
      agentEnabled: true,
      suppressed: fixture.lead.suppressed,
      optedOut: fixture.lead.optedOut,
    },
  });
  return { decision, plan };
}

function classifyOutcome(input: {
  failures: readonly GateFailure[];
  duplicate: boolean;
  serviceIsListed: boolean;
  bookingCommitFailed: boolean;
  bookingConflict: boolean;
}): SandboxOutcome {
  if (input.duplicate) return "SANDBOX_BLOCKED_DUPLICATE";
  const has = (gates: readonly GateId[]) => input.failures.some((f) => gates.includes(f.gate));
  if (!input.serviceIsListed || input.bookingCommitFailed || has(STATE_GATES))
    return "SANDBOX_BLOCKED_STATE_INCONSISTENCY";
  if (has(CONSENT_GATES)) return "SANDBOX_BLOCKED_CONSENT";
  if (has(OWNER_REVIEW_GATES)) return "SANDBOX_BLOCKED_OWNER_REVIEW";
  if (has(REACHABILITY_GATES)) return "SANDBOX_BLOCKED_REACHABILITY";
  if (input.bookingConflict || has(["booking_conflict"])) return "SANDBOX_BLOCKED_BOOKING";
  if (has(["quiet_hours"])) return "SANDBOX_BLOCKED_QUIET_HOURS";
  if (has(CAP_GATES)) return "SANDBOX_BLOCKED_CAP";
  if (input.failures.length > 0) return "SANDBOX_BLOCKED_STATE_INCONSISTENCY";
  return "SANDBOX_ELIGIBLE";
}

/**
 * Sandbox eligibility, shared with production. The live gate evaluation and the
 * sandbox call the identical `evaluateActivationGates`, so identical state
 * always yields the identical decision.
 */
export function sandboxEligibility(fixture: SandboxFixture): {
  plan: SequencePlan;
  decision: SequenceDecision;
  facts: GateFacts;
  failures: readonly GateFailure[];
  eligible: boolean;
} {
  const { decision, plan } = sandboxPlan(fixture);
  const facts = sandboxGateFacts(fixture, plan);
  const failures = evaluateActivationGates(facts);
  return { plan, decision, facts, failures, eligible: failures.length === 0 };
}

function bookingStage(fixture: SandboxFixture): {
  decision: (BookingDecision & { stage: string }) | null;
  slot: { selected: FakeCalendarSlot | null; declined: boolean } | null;
  commitFailed: boolean;
  wouldCreateJob: boolean;
} {
  if (fixture.bookingBehaviour === "not_applicable")
    return { decision: null, slot: null, commitFailed: false, wouldCreateJob: false };

  const leadRow = {
    id: fixture.leadFixtureId,
    business_id: SANDBOX_TENANT_ID,
    status: "new",
    opted_out_at: fixture.lead.optedOut ? fixture.nowIso : null,
    sms_suppressed_at: fixture.lead.suppressed ? fixture.nowIso : null,
  };

  const offerDecision = assessOfferGeneration({
    businessId: SANDBOX_TENANT_ID,
    lead: leadRow,
    availabilityActive: true,
    serviceDurationMinutes: fixture.serviceDurationMinutes,
    slotCount: 2,
  });
  if (!offerDecision.allowed)
    return {
      decision: { ...offerDecision, stage: "offer_generation" },
      slot: { selected: null, declined: true },
      commitFailed: false,
      wouldCreateJob: false,
    };

  if (fixture.bookingBehaviour === "declined")
    return {
      decision: { allowed: false, reason: null, needsHumanReview: false, stage: "customer_declined" },
      slot: { selected: null, declined: true },
      commitFailed: false,
      wouldCreateJob: false,
    };

  const selected: FakeCalendarSlot = {
    id: "fake-slot-1",
    startsAt: "2026-09-07T23:00:00.000Z",
    label: "Tue 9:00 am",
    available: true,
  };
  const slotStillAvailable = fixture.bookingBehaviour !== "commit_failure";
  const confirm = assessBookingConfirmation({
    businessId: SANDBOX_TENANT_ID,
    lead: leadRow,
    offer: {
      id: `sandbox-offer-${fixture.leadFixtureId}`,
      business_id: SANDBOX_TENANT_ID,
      lead_id: fixture.leadFixtureId,
      status: "accepted",
      expires_at: new Date(new Date(fixture.nowIso).getTime() + 3_600_000).toISOString(),
      accepted_message_id: `sandbox-inbound-${fixture.leadFixtureId}`,
      slot_start: selected.startsAt,
    },
    slotStillAvailable,
    now: new Date(fixture.nowIso),
  });

  return {
    decision: { ...confirm, stage: `booking_${fixture.bookingBehaviour}` },
    slot: { selected, declined: false },
    commitFailed: !confirm.allowed,
    // "Would create job" only — the sandbox never writes an offer or a job.
    wouldCreateJob: confirm.allowed,
  };
}

/** Create an isolated sandbox run. Every artefact is traceable to this run. */
export function createSandboxRun(input?: {
  tenantId?: string;
  testRunId?: string;
  createdAt?: string;
  adapters?: SandboxAdapters;
}): SandboxRun {
  const adapters = input?.adapters ?? createSandboxAdapters();
  assertSandboxIsolation(adapters);

  const runTrace = {
    tenantId: input?.tenantId ?? SANDBOX_TENANT_ID,
    testRunId: input?.testRunId ?? `sandbox-run-${SANDBOX_TENANT_ID}`,
    executionMode: SANDBOX_EXECUTION_MODE,
    createdAt: input?.createdAt ?? "2026-09-04T00:00:00.000Z",
  } as const;

  const records: SandboxRecord[] = [];
  const seenKeys = new Set<string>();

  return {
    trace: runTrace,
    adapters,
    records: () => records,
    recordedSms: () => adapters.sms.entries(),
    execute(fixture) {
      assertSandboxIsolation(adapters);
      if (fixture.gateOverrides?.businessId && fixture.gateOverrides.businessId !== runTrace.tenantId) {
        throw new Error("Sandbox tenant isolation: fixture business differs from the run tenant.");
      }

      const trace: SandboxTrace = {
        ...runTrace,
        scenarioId: fixture.scenarioId,
        leadFixtureId: fixture.leadFixtureId,
      };

      const { plan, decision, facts, failures } = sandboxEligibility(fixture);
      const action = firstMessagingAction(plan);
      const quiet = evaluateQuietHours(fixture);
      const booking = bookingStage(fixture);

      const idempotencyKey =
        action?.idempotencyKey ??
        `seq:${runTrace.tenantId}:${fixture.leadFixtureId}:${plan.sequence}:${action?.kind ?? "no_action"}`;

      for (const prior of fixture.priorOutboundKeys ?? []) seenKeys.add(prior);
      const duplicate = seenKeys.has(idempotencyKey) || Boolean(fixture.duplicateProviderEvent);
      seenKeys.add(idempotencyKey);

      const outcome = classifyOutcome({
        failures,
        duplicate,
        serviceIsListed: fixture.serviceIsListed,
        bookingCommitFailed: booking.commitFailed && fixture.bookingBehaviour === "commit_failure",
        bookingConflict: facts.hasConflictingBooking === true || fixture.lead.bookingStatus === "scheduled",
      });

      const eligible = outcome === "SANDBOX_ELIGIBLE";
      const rendered =
        action?.templateId !== null && action?.templateId !== undefined
          ? renderAgentMessage(action.templateId, {
              leadName: fixture.lead.name,
              businessName: SANDBOX_BUSINESS_NAME,
              approvedServiceName: fixture.approvedServiceName,
              bookingLink: SANDBOX_BOOKING_LINK,
              slotLabels: booking.slot?.selected ? [booking.slot.selected.label] : ["Tue 9:00 am", "Tue 12:00 pm"],
            })
          : null;

      const messageSource = "agent_automation";
      const attribution = normaliseAgentAttribution({
        sequenceId: plan.sequence,
        templateId: action?.templateId ?? null,
        actionKind: action && action.kind !== "no_action" ? action.kind : null,
      });

      // Recorder capture: happens for every run, eligible or blocked, and never
      // sends. A blocked run records `wouldSend: false`.
      const recorded = rendered
        ? adapters.sms.record({
            trace,
            recipient: fixture.lead.phone,
            sequenceId: plan.sequence,
            templateId: rendered.templateId,
            templateVersion: rendered.templateVersion,
            body: rendered.body,
            substitutions: rendered.substitutions,
            segments: rendered.segmentInfo.segments,
            encoding: rendered.segmentInfo.encoding,
            messageSource,
            actionKind: action?.kind ?? "record_audit",
            idempotencyKey,
          })
        : null;

      if (!eligible) {
        adapters.notifications.record({
          trace,
          kind: "sandbox_blocked",
          detail: `${outcome}: ${failures.map((f) => f.gate).join(",") || "no gate failure"}`,
        });
      }

      const record: SandboxRecord = {
        trace,
        scenarioDescription: fixture.description,
        outcome,
        eligibilityDecision: eligible ? "eligible" : "blocked",
        sequenceId: plan.sequence,
        sequenceReason: decision.reason,
        templateId: action?.templateId ?? null,
        templateVersion: AGENT_TEMPLATE_VERSION,
        actionKind: action?.kind ?? "no_action",
        intendedRecipient: fixture.lead.phone,
        renderedSms: rendered?.body ?? null,
        substitutions: rendered?.substitutions ?? [],
        segments: rendered?.segmentInfo.segments ?? 0,
        messageSource,
        attribution: {
          sequence_id: attribution.ok ? attribution.attribution.sequenceId : null,
          template_id: attribution.ok ? attribution.attribution.templateId : null,
          agent_action_id: null,
        },
        idempotencyKey,
        gatesPassed: passedGates(GATE_IDS, failures),
        gatesFailed: failures,
        suppressionCheck: {
          suppressed: fixture.lead.suppressed,
          optedOut: fixture.lead.optedOut,
          stopKeywordSeen: fixture.lead.stopKeywordSeen,
          blocked: fixture.lead.suppressed || fixture.lead.optedOut || fixture.lead.stopKeywordSeen,
        },
        quietHours: quiet,
        capEvaluation: {
          sentToday: fixture.caps.sentToday,
          dailyCap: fixture.caps.dailyCap,
          sentThisHour: fixture.caps.sentThisHour,
          hourlyCap: fixture.caps.hourlyCap,
          blocked: failures.some((f) => CAP_GATES.includes(f.gate)),
        },
        ownerReview: {
          blocked: failures.some((f) => OWNER_REVIEW_GATES.includes(f.gate)),
          failures: failures.filter((f) => OWNER_REVIEW_GATES.includes(f.gate)),
        },
        bookingDecision: booking.decision,
        calendarSlot: booking.slot,
        wouldCreateJob: eligible && booking.wouldCreateJob,
        wouldSend: eligible && Boolean(rendered) && !duplicate,
        didSend: false,
        duplicateSuppressed: recorded?.duplicateSuppressed ?? duplicate,
        plan,
      };

      records.push(record);
      return record;
    },
  };
}

/** Run every scenario in one isolated sandbox run. */
export function runSandboxSuite(input?: { testRunId?: string; createdAt?: string }): {
  run: SandboxRun;
  records: readonly SandboxRecord[];
} {
  const run = createSandboxRun(input);
  const records = SANDBOX_SCENARIOS.map((fixture) => run.execute(fixture));
  return { run, records };
}
