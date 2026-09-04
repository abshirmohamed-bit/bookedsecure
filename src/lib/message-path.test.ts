import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BOOKED_LEAD_TEMPLATES,
  NEW_LEAD_RESPONSE_TEMPLATES,
  buildOutboundDecision,
  classifyMessagePath,
  evaluateNewLeadResponseExemption,
  nextPermittedSendAt,
  type NewLeadResponseFacts,
} from "./message-path";
import { evaluateActivationGates, type GateFacts } from "./agent-gates";
import { runSandboxSuite } from "./sandbox/runner";

const SYDNEY = { timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 };
const LEAD = "11111111-2222-3333-4444-555555555555";

/** 21:01 and 09:30 Sydney (UTC+10) as absolute instants. */
const AT_2101_SYDNEY = new Date("2026-09-04T11:01:00.000Z");
const AT_0930_SYDNEY = new Date("2026-09-04T23:30:00.000Z");

function facts(overrides: Partial<NewLeadResponseFacts> = {}): NewLeadResponseFacts {
  return {
    customerInitiated: true,
    quoteFlowActive: true,
    directResponseToCurrentEnquiry: true,
    consentGranted: true,
    consentLeadId: LEAD,
    leadId: LEAD,
    optedOut: false,
    suppressed: false,
    requiresOwnerReview: false,
    humanTakeoverActive: false,
    automationPaused: false,
    templateId: "quote_chat_completion_step",
    templateVersion: 1,
    promotional: false,
    serviceRelated: true,
    alreadyBooked: false,
    tenantKillSwitchAt: null,
    globalKillSwitchAt: null,
    idempotencyKey: `newlead:${LEAD}:step1`,
    sourceAttribution: "agent_automation",
    sequenceId: "quote_chat_completion",
    ...overrides,
  };
}

function decide(overrides: Partial<NewLeadResponseFacts> = {}, at = AT_2101_SYDNEY, extra?: {
  otherGatesPassed?: boolean;
  alreadySent?: boolean;
}) {
  return buildOutboundDecision({
    facts: facts(overrides),
    quietHours: SYDNEY,
    at,
    otherGatesPassed: extra?.otherGatesPassed ?? true,
    ...(extra?.alreadySent === undefined ? {} : { alreadySent: extra.alreadySent }),
  });
}

/** Fully-passing gate facts; individual tests vary one dimension at a time. */
function gateFacts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    actionKind: "send_message",
    businessId: "b1",
    leadBusinessId: "b1",
    campaignBusinessId: "b1",
    tenantOptedInAt: "2026-09-01T00:00:00.000Z",
    agentEnabled: true,
    tenantKillSwitchAt: null,
    globalKillSwitchAt: null,
    campaignStatus: "approved",
    campaignDisabledAt: null,
    campaignApprovedAt: "2026-09-01T00:00:00.000Z",
    sequenceApprovedAt: "2026-09-01T00:00:00.000Z",
    campaignSequenceId: "quote_chat_completion",
    plannedSequenceId: "quote_chat_completion",
    approvedTemplateVersion: 1,
    plannedTemplateVersion: 1,
    scopeLeadIds: [LEAD],
    leadId: LEAD,
    executionAuthorisedAt: "2026-09-01T00:00:00.000Z",
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
    quietHoursNow: true,
    sentToday: 0,
    dailySendCap: 50,
    sentThisHour: 0,
    hourlySendCap: 10,
    leadsInActivation: 1,
    maxLeadsPerActivation: 5,
    planStillCurrent: true,
    ...overrides,
  };
}

const gateIds = (f: GateFacts) => evaluateActivationGates(f).map((x) => x.gate);

describe("quiet-hours policy paths", () => {
  it("1. a fresh customer-initiated consented quote lead passes quiet hours on an approved new-lead response", () => {
    const d = decide();
    expect(d.message_path).toBe("new_lead_response");
    expect(d.quiet_hours_applied).toBe(false);
    expect(d.quiet_hours_reason).toBe("approved new-lead response, exempt inside quiet hours");
    expect(d.eligible).toBe(true);
    expect(d.wouldSend).toBe(true);
    expect(evaluateNewLeadResponseExemption(facts()).granted).toBe(true);

    // The gate agrees only with a server-verified exemption on this path.
    expect(
      gateIds(gateFacts({ messagePath: "new_lead_response", quietHoursExemptionGranted: true })),
    ).not.toContain("quiet_hours");
  });

  it("2. a sequence follow-up at 21:01 Sydney is blocked and visible in the gate report", () => {
    const d = decide({ directResponseToCurrentEnquiry: false, customerInitiated: false });
    expect(d.message_path).toBe("sequence_follow_up");
    expect(d.quiet_hours_applied).toBe(true);
    expect(d.current_local_time).toContain("21:01");
    expect(d.quiet_hours_reason).toContain("deferred, not dropped");
    expect(d.eligible).toBe(false);
    expect(d.wouldSend).toBe(false);

    const failures = evaluateActivationGates(gateFacts({ messagePath: "sequence_follow_up" }));
    const quiet = failures.find((f) => f.gate === "quiet_hours");
    expect(quiet?.detail).toContain("sequence follow-up deferred, not dropped");
    // Default (no path supplied) still enforces quiet hours.
    expect(gateIds(gateFacts())).toContain("quiet_hours");
  });

  it("3. a blocked sequence resumes at 08:00 Sydney without duplication", () => {
    const d = decide({ customerInitiated: false });
    const resumeAt = new Date(d.next_permitted_send_at);
    expect(
      new Intl.DateTimeFormat("en-AU", {
        timeZone: SYDNEY.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(resumeAt),
    ).toBe("08:00");
    // Same key at the resume time sends once, and a replay sends nothing more.
    const resumed = decide({ customerInitiated: false }, resumeAt);
    expect(resumed.quiet_hours_applied).toBe(false);
    expect(resumed.wouldSend).toBe(true);
    expect(resumed.idempotency_key).toBe(d.idempotency_key);
    expect(decide({ customerInitiated: false }, resumeAt, { alreadySent: true }).wouldSend).toBe(false);
  });

  it("4. a new-lead response is still blocked by missing consent", () => {
    const d = decide({ consentGranted: false, consentLeadId: null });
    expect(d.consent_result).toBe("missing");
    expect(d.quiet_hours_applied).toBe(true);
    expect(d.eligible).toBe(false);
    // Consent captured against a different lead id never counts.
    expect(decide({ consentLeadId: "other-lead" }).consent_result).toBe("wrong_lead");
    expect(decide({ consentLeadId: "other-lead" }).eligible).toBe(false);
  });

  it("5. a new-lead response is still blocked by owner review or human takeover", () => {
    expect(decide({ requiresOwnerReview: true }).owner_review_result).toBe("required");
    expect(decide({ requiresOwnerReview: true }).eligible).toBe(false);
    expect(decide({ humanTakeoverActive: true }).human_takeover_result).toBe("active");
    expect(decide({ humanTakeoverActive: true }).eligible).toBe(false);
    expect(decide({ automationPaused: true }).eligible).toBe(false);
  });

  it("6. a new-lead response is still blocked by STOP or suppression", () => {
    expect(decide({ optedOut: true }).suppression_result).toBe("opted_out");
    expect(decide({ optedOut: true }).quiet_hours_applied).toBe(true);
    expect(decide({ suppressed: true }).suppression_result).toBe("suppressed");
    expect(decide({ suppressed: true }).eligible).toBe(false);
  });

  it("7. a booked lead cannot receive an inappropriate new-lead response", () => {
    const bad = decide({ alreadyBooked: true });
    expect(bad.booking_result).toBe("booked_blocked");
    expect(bad.quiet_hours_applied).toBe(true);
    expect(bad.eligible).toBe(false);

    for (const templateId of BOOKED_LEAD_TEMPLATES) {
      const ok = decide({ alreadyBooked: true, templateId, templateVersion: 1 });
      expect(ok.booking_result).toBe("booked_allowed");
      expect(ok.quiet_hours_applied).toBe(false);
    }
  });

  it("7b. reactivation, dormant, bulk and nurture outreach can never take the new-lead path", () => {
    for (const sequenceId of [
      "previous_customer_reactivation",
      "historical_booking_link",
      "contact_only_introduction",
      "abandoned_quote_recovery",
    ] as const) {
      const d = decide({ sequenceId, templateId: "quote_chat_completion_step" });
      expect(d.message_path).toBe("sequence_follow_up");
      expect(d.quiet_hours_applied).toBe(true);
    }
    // Promotional content is excluded even on an approved template.
    expect(decide({ promotional: true }).message_path).toBe("sequence_follow_up");
    expect(decide({ serviceRelated: false }).quiet_hours_applied).toBe(true);
    // Only allow-listed templates classify as new-lead responses.
    expect(classifyMessagePath(facts({ templateId: "previous_customer_reactivation" }))).toBe(
      "sequence_follow_up",
    );
    expect(Object.keys(NEW_LEAD_RESPONSE_TEMPLATES)).not.toContain("previous_customer_reactivation");
  });

  it("8. manual outbound remains subject to its existing controls", () => {
    const manual = readFileSync("src/lib/sms/dispatch.ts", "utf8");
    const engine = readFileSync("src/lib/agent-gates.ts", "utf8");
    // The policy lives in the agent gates only; the manual SMS path is untouched.
    expect(manual).not.toContain("message-path");
    expect(manual).not.toContain("new_lead_response");
    // Manual/human handling still blocks agent execution.
    expect(gateIds(gateFacts({ latestOutboundIsManual: true }))).toContain("owner_review");
    expect(engine).toContain("manual messaging is untouched");
  });

  it("9. the tenant timezone is used, not server UTC", () => {
    const d = decide({ customerInitiated: false });
    expect(d.tenant_timezone).toBe("Australia/Sydney");
    // 11:01 UTC is inside Sydney quiet hours; a UTC evaluation would allow it.
    expect(AT_2101_SYDNEY.getUTCHours()).toBe(11);
    expect(d.quiet_hours_applied).toBe(true);
    // 23:30 UTC is 09:30 Sydney — permitted, though UTC would call it quiet.
    const day = decide({ customerInitiated: false }, AT_0930_SYDNEY);
    expect(AT_0930_SYDNEY.getUTCHours()).toBe(23);
    expect(day.quiet_hours_applied).toBe(false);
    expect(day.current_local_time).toContain("09:30");
    expect(nextPermittedSendAt(SYDNEY, AT_0930_SYDNEY)).toBe(AT_0930_SYDNEY.toISOString());
  });

  it("10. no other gate, cap, authorisation, campaign, booking or consent rule changes", () => {
    // Exemption relaxes quiet hours only — everything else still fails.
    const exempt = { messagePath: "new_lead_response", quietHoursExemptionGranted: true } as const;
    expect(gateIds(gateFacts({ ...exempt, dailySendCap: 0 }))).toContain("daily_volume_limit");
    expect(gateIds(gateFacts({ ...exempt, sentThisHour: 10 }))).toContain("hourly_rate_limit");
    expect(gateIds(gateFacts({ ...exempt, executionAuthorisedAt: null }))).toContain(
      "execution_authorisation",
    );
    expect(gateIds(gateFacts({ ...exempt, tenantOptedInAt: null }))).toContain("tenant_opt_in");
    expect(gateIds(gateFacts({ ...exempt, campaignApprovedAt: null }))).toContain("campaign_approved");
    expect(gateIds(gateFacts({ ...exempt, consentGranted: false }))).toContain("consent");
    expect(gateIds(gateFacts({ ...exempt, suppressed: true }))).toContain("suppression");
    expect(gateIds(gateFacts({ ...exempt, optedOut: true }))).toContain("opt_out");
    expect(gateIds(gateFacts({ ...exempt, hasConflictingBooking: true }))).toContain("booking_conflict");
    expect(gateIds(gateFacts({ ...exempt, requiresOwnerReview: true }))).toContain("lead_eligibility");
    expect(gateIds(gateFacts({ ...exempt, globalKillSwitchAt: "2026-09-01T00:00:00.000Z" }))).toContain(
      "global_kill_switch",
    );
    // Provider delivery handling is not referenced by the policy module.
    const policy = readFileSync("src/lib/message-path.ts", "utf8");
    for (const forbidden of ["fetch(", "supabase", "sendSms", "delivery", "insert("]) {
      expect(policy).not.toContain(forbidden);
    }
  });

  it("11. provider calls remain zero in sandbox mode", () => {
    const run = runSandboxSuite({ testRunId: "quiet-hours-policy-regression" });
    expect(run.run.recordedSms().every((sms) => sms.sent === false)).toBe(true);
    expect(run.records.some((r) => r.outcome === "SANDBOX_BLOCKED_QUIET_HOURS")).toBe(true);
    expect(run.records.every((r) => r.didSend === false)).toBe(true);
  });

  it("12. duplicate retries create no additional send", () => {
    const first = decide();
    const retry = decide({}, AT_2101_SYDNEY, { alreadySent: true });
    expect(first.wouldSend).toBe(true);
    expect(retry.eligible).toBe(true);
    expect(retry.wouldSend).toBe(false);
    expect(retry.idempotency_key).toBe(first.idempotency_key);
    // A send without an idempotency key or attribution is never eligible.
    expect(decide({ idempotencyKey: null }).eligible).toBe(false);
    expect(decide({ sourceAttribution: null }).eligible).toBe(false);
  });

  it("every outbound decision returns the full report shape", () => {
    expect(Object.keys(decide()).sort()).toEqual(
      [
        "booking_result",
        "consent_result",
        "current_local_time",
        "eligible",
        "exemption_failures",
        "human_takeover_result",
        "idempotency_key",
        "message_path",
        "next_permitted_send_at",
        "owner_review_result",
        "quiet_hours_applied",
        "quiet_hours_reason",
        "source_attribution",
        "suppression_result",
        "template_id",
        "template_version",
        "tenant_timezone",
        "wouldSend",
      ].sort(),
    );
  });
});
