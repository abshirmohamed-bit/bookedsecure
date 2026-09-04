import { describe, expect, it } from "vitest";
import {
  EXECUTION_MODES,
  GATE_IDS,
  MANUAL_OUTBOUND_RECENCY_HOURS,
  OUTBOUND_ACTION_KINDS,
  evaluateOwnerHandling,
  evaluateActivationGates,
  resolveExecutionMode,
  type GateFacts,
  type GateId,
} from "./agent-gates";

const B = "biz-1";
const L = "lead-1";

/** Every gate passing, for an outbound send. Tests break exactly one at a time. */
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
    campaignSequenceId: "contact_only_introduction",
    plannedSequenceId: "contact_only_introduction",
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

function gates(overrides: Partial<GateFacts>): GateId[] {
  return evaluateActivationGates(passingFacts(overrides)).map((f) => f.gate);
}

describe("activation gates", () => {
  it("passes only when every gate is satisfied", () => {
    expect(evaluateActivationGates(passingFacts())).toEqual([]);
  });

  it("exposes a stable gate and mode vocabulary", () => {
    expect(EXECUTION_MODES).toEqual(["dry_run", "live"]);
    expect(new Set(GATE_IDS).size).toBe(GATE_IDS.length);
    expect(OUTBOUND_ACTION_KINDS).toContain("capture_consent");
    expect(OUTBOUND_ACTION_KINDS).toContain("send_message");
  });

  const singleGateCases: [string, Partial<GateFacts>, GateId][] = [
    ["tenant has not opted in", { tenantOptedInAt: null }, "tenant_opt_in"],
    ["agent disabled", { agentEnabled: false }, "agent_enabled"],
    ["global kill switch", { globalKillSwitchAt: "now" }, "global_kill_switch"],
    ["tenant kill switch", { tenantKillSwitchAt: "now" }, "tenant_kill_switch"],
    ["campaign unapproved", { campaignApprovedAt: null }, "campaign_approved"],
    ["campaign disabled", { campaignDisabledAt: "now" }, "campaign_approved"],
    ["campaign rolled back", { campaignStatus: "rolled_back" }, "campaign_approved"],
    ["sequence unapproved", { sequenceApprovedAt: null }, "sequence_approved"],
    ["sequence mismatch", { plannedSequenceId: "previous_customer_reactivation" }, "sequence_approved"],
    ["template version drift", { plannedTemplateVersion: 2 }, "template_version_approved"],
    ["empty scope", { scopeLeadIds: [] }, "lead_scope"],
    ["lead outside scope", { scopeLeadIds: ["other-lead"] }, "lead_scope"],
    ["no execution authorisation", { executionAuthorisedAt: null }, "execution_authorisation"],
    ["owner review", { requiresOwnerReview: true }, "lead_eligibility"],
    ["opted out", { optedOut: true }, "opt_out"],
    ["suppressed", { suppressed: true }, "suppression"],
    ["takeover", { tenantTakeover: true }, "tenant_takeover"],
    ["automation paused", { automationPaused: true }, "automation_paused"],
    ["booking conflict", { hasConflictingBooking: true }, "booking_conflict"],
    ["unreachable", { reachable: false }, "reachability"],
    ["consent declined", { consentDeclined: true }, "consent"],
    ["consent missing", { consentGranted: false }, "consent"],
    ["quiet hours", { quietHoursNow: true }, "quiet_hours"],
    ["daily cap unset", { dailySendCap: 0 }, "daily_volume_limit"],
    ["daily cap reached", { sentToday: 5 }, "daily_volume_limit"],
    ["hourly cap unset", { hourlySendCap: 0 }, "hourly_rate_limit"],
    ["hourly cap reached", { sentThisHour: 2 }, "hourly_rate_limit"],
    ["activation cap unset", { maxLeadsPerActivation: 0 }, "activation_lead_cap"],
    ["activation cap exceeded", { leadsInActivation: 9 }, "activation_lead_cap"],
    ["stale plan", { planStillCurrent: false }, "plan_freshness"],
    ["lead of another tenant", { leadBusinessId: "biz-2" }, "tenant_scope"],
    ["campaign of another tenant", { campaignBusinessId: "biz-2" }, "tenant_scope"],
  ];

  for (const [label, override, gate] of singleGateCases) {
    it(`blocks live execution: ${label}`, () => {
      const failures = gates(override);
      expect(failures).toContain(gate);
      expect(
        resolveExecutionMode({
          requestedMode: "live",
          serverVerifiedGateFailures: evaluateActivationGates(passingFacts(override)),
        }),
      ).toMatchObject({ mode: "dry_run", allowed: false });
    });
  }

  it("treats tenant opt-in alone as insufficient", () => {
    const failures = gates({
      campaignApprovedAt: null,
      sequenceApprovedAt: null,
      executionAuthorisedAt: null,
      scopeLeadIds: [],
    });
    expect(failures).toEqual(
      expect.arrayContaining([
        "campaign_approved",
        "sequence_approved",
        "execution_authorisation",
        "lead_scope",
      ]),
    );
  });

  it("has no implicit all-leads audience", () => {
    expect(gates({ scopeLeadIds: [] })).toContain("lead_scope");
  });

  it("gates capture_consent as a real outbound SMS action", () => {
    // Consent capture is allowed without prior consent, but still needs
    // reachability, quiet hours, opt-out, suppression and volume gates.
    expect(
      evaluateActivationGates(
        passingFacts({ actionKind: "capture_consent", consentCaptureAction: true, consentGranted: false }),
      ),
    ).toEqual([]);
    expect(
      gates({ actionKind: "capture_consent", consentCaptureAction: true, consentGranted: false, quietHoursNow: true }),
    ).toContain("quiet_hours");
    expect(
      gates({ actionKind: "capture_consent", consentCaptureAction: true, consentGranted: false, suppressed: true }),
    ).toContain("suppression");
    expect(
      gates({ actionKind: "capture_consent", consentCaptureAction: true, consentGranted: false, optedOut: true }),
    ).toContain("opt_out");
    expect(
      gates({ actionKind: "capture_consent", consentCaptureAction: true, consentGranted: false, dailySendCap: 0 }),
    ).toContain("daily_volume_limit");
  });

  it("rejects redundant consent capture when consent already exists", () => {
    expect(gates({ actionKind: "capture_consent", consentCaptureAction: true })).toContain("consent");
  });

  it("does not apply send gates to non-outbound actions", () => {
    const failures = gates({
      actionKind: "record_audit",
      quietHoursNow: true,
      consentGranted: false,
      dailySendCap: 0,
      hourlySendCap: 0,
    });
    expect(failures).not.toContain("quiet_hours");
    expect(failures).not.toContain("consent");
    expect(failures).not.toContain("daily_volume_limit");
  });

  it("never lets a client activate live mode", () => {
    const clean = evaluateActivationGates(passingFacts());
    expect(resolveExecutionMode({ requestedMode: undefined, serverVerifiedGateFailures: clean })).toMatchObject({
      mode: "dry_run",
      allowed: false,
    });
    expect(resolveExecutionMode({ requestedMode: "LIVE", serverVerifiedGateFailures: clean })).toMatchObject({
      mode: "dry_run",
    });
    expect(resolveExecutionMode({ requestedMode: "dry_run", serverVerifiedGateFailures: clean })).toMatchObject({
      mode: "dry_run",
    });
    // Live only when the server itself found zero failures.
    expect(resolveExecutionMode({ requestedMode: "live", serverVerifiedGateFailures: clean })).toMatchObject({
      mode: "live",
      allowed: true,
    });
  });

  it("reports all failures, not just the first", () => {
    const failures = evaluateActivationGates(
      passingFacts({ agentEnabled: false, optedOut: true, planStillCurrent: false }),
    );
    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(failures.every((f) => f.detail.length > 0)).toBe(true);
  });
});

describe("owner-handling gate (agent execution eligibility only)", () => {
  const NOW = "2026-09-04T09:00:00Z";
  const recent = "2026-09-03T05:08:00Z";
  const old = "2026-08-01T05:08:00Z";

  const ownerCases: [string, Partial<GateFacts>][] = [
    ["conversation is owner_handling", { conversationStatus: "owner_handling" }],
    [
      "needs_attention with recent manual outbound",
      { conversationStatus: "needs_attention", lastManualOutboundAt: recent },
    ],
    ["latest outbound is manual", { latestOutboundIsManual: true }],
    [
      "owner messaged after the latest inbound reply",
      { lastManualOutboundAt: recent, lastInboundReplyAt: "2026-09-01T08:32:58Z" },
    ],
    ["owner review flag present", { ownerReviewFlag: true }],
    ["human takeover active", { humanTakeoverActive: true }],
  ];

  for (const [label, override] of ownerCases) {
    it(`blocks with owner_review: ${label}`, () => {
      const facts = passingFacts({ nowIso: NOW, ...override });
      const failures = evaluateActivationGates(facts);
      expect(failures.map((f) => f.gate)).toContain("owner_review");
      expect(evaluateOwnerHandling(facts).length).toBeGreaterThan(0);
      expect(
        resolveExecutionMode({ requestedMode: "live", serverVerifiedGateFailures: failures }),
      ).toMatchObject({ mode: "dry_run", allowed: false });
    });
  }

  it("does not block when no human involvement signal is present", () => {
    expect(
      evaluateOwnerHandling({
        nowIso: NOW,
        conversationStatus: "active",
        lastManualOutboundAt: null,
        latestOutboundIsManual: false,
        lastInboundReplyAt: "2026-09-01T08:32:58Z",
      }),
    ).toEqual([]);
    expect(evaluateActivationGates(passingFacts({ nowIso: NOW }))).toEqual([]);
  });

  it("treats stale manual outbound on needs_attention as not recent", () => {
    const failures = evaluateOwnerHandling({
      nowIso: NOW,
      conversationStatus: "needs_attention",
      lastManualOutboundAt: old,
      lastInboundReplyAt: "2026-09-02T00:00:00Z",
    });
    expect(failures).toEqual([]);
    expect(MANUAL_OUTBOUND_RECENCY_HOURS).toBe(72);
  });

  it("does not block when the inbound reply is newer than the manual outbound", () => {
    expect(
      evaluateOwnerHandling({
        nowIso: NOW,
        conversationStatus: "active",
        lastManualOutboundAt: "2026-09-01T00:00:00Z",
        lastInboundReplyAt: "2026-09-02T00:00:00Z",
      }),
    ).toEqual([]);
  });

  it("keeps owner_review in the stable gate vocabulary", () => {
    expect(GATE_IDS).toContain("owner_review");
  });
});
