// Sandbox scenario fixtures.
//
// Pure data. Every fixture is a synthetic lead on the dedicated sandbox tenant:
// no fixture references a production lead id, and nothing here is ever written
// to the database. Fixtures exist so the sandbox exercises the SAME consent,
// qualification, owner-review, rendering, booking, suppression, quiet-hours,
// cap, attribution and idempotency logic production uses.

import type { GateFacts } from "../agent-gates";
import type { BookingStatus, ConsentStatus, LeadContext } from "../lead-provenance";

/** Dedicated sandbox tenant. Never a real tenant, never Glocast. */
export const SANDBOX_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const SANDBOX_BUSINESS_NAME = "Sandbox Detailing (test tenant)";
export const SANDBOX_TIMEZONE = "Australia/Sydney";
export const SANDBOX_BOOKING_LINK = "https://sandbox.invalid/quote/sandbox";

export type BookingBehaviour =
  | "not_applicable"
  | "accepted"
  | "declined"
  | "commit_failure"
  | "commit_retry";

export type SandboxFixture = {
  scenarioId: string;
  description: string;
  leadFixtureId: string;
  lead: {
    name: string;
    phone: string;
    leadContext: LeadContext;
    consentStatus: ConsentStatus;
    bookingStatus: BookingStatus;
    optedOut: boolean;
    suppressed: boolean;
    /** false models "unknown or unreachable" — an outbound blocker. */
    reachable: boolean;
    requiresOwnerReview: boolean;
    stopKeywordSeen: boolean;
    hasInboundReply: boolean;
  };
  /** Approved (allow-listed) service name, or null when the ask is unlisted. */
  approvedServiceName: string | null;
  requestedServiceName: string;
  serviceIsListed: boolean;
  serviceDurationMinutes: number | null;
  /** Evaluation instant, ISO. Quiet hours are evaluated in tenant time. */
  nowIso: string;
  caps: { sentToday: number; dailyCap: number; sentThisHour: number; hourlyCap: number };
  gateOverrides?: Partial<GateFacts>;
  bookingBehaviour: BookingBehaviour;
  /** Re-running the same execution intent (retry / duplicate provider event). */
  replaysScenarioId?: string;
  duplicateProviderEvent?: boolean;
  /** Idempotency keys already recorded for this lead (prior outbound SMS). */
  priorOutboundKeys?: readonly string[];
};

/** Midday and late-night reference instants in Australia/Sydney. */
const MIDDAY = "2026-09-07T02:00:00.000Z"; // 12:00 Sydney
const LATE_NIGHT = "2026-09-07T13:00:00.000Z"; // 23:00 Sydney

const CAPS_OK = { sentToday: 3, dailyCap: 50, sentThisHour: 1, hourlyCap: 10 };

const base = (over: Partial<SandboxFixture> & Pick<SandboxFixture, "scenarioId" | "description" | "leadFixtureId">): SandboxFixture => ({
  lead: {
    name: "Sandbox Lead",
    phone: "+61400000001",
    leadContext: "quote_chat_lead",
    consentStatus: "granted",
    bookingStatus: "none",
    optedOut: false,
    suppressed: false,
    reachable: true,
    requiresOwnerReview: false,
    stopKeywordSeen: false,
    hasInboundReply: false,
  },
  approvedServiceName: "Full Detail",
  requestedServiceName: "Full Detail",
  serviceIsListed: true,
  serviceDurationMinutes: 180,
  nowIso: MIDDAY,
  caps: CAPS_OK,
  bookingBehaviour: "not_applicable",
  ...over,
});

const lead = (over: Partial<SandboxFixture["lead"]>) => ({ ...base({ scenarioId: "", description: "", leadFixtureId: "" }).lead, ...over });

export const SANDBOX_SCENARIOS: readonly SandboxFixture[] = [
  base({
    scenarioId: "S01_fresh_website_lead_consented",
    description: "Fresh website lead with explicit SMS consent.",
    leadFixtureId: "fixture-01-website-consented",
  }),
  base({
    scenarioId: "S02_crm_import_no_consent",
    description: "CRM-imported lead without consent.",
    leadFixtureId: "fixture-02-crm-no-consent",
    lead: lead({ leadContext: "contact_only_unqualified", consentStatus: "unknown", phone: "+61400000002" }),
    approvedServiceName: null,
  }),
  base({
    scenarioId: "S03_opted_out",
    description: "Opted-out lead.",
    leadFixtureId: "fixture-03-opted-out",
    lead: lead({ consentStatus: "opted_out", optedOut: true, stopKeywordSeen: true, phone: "+61400000003" }),
  }),
  base({
    scenarioId: "S04_suppressed",
    description: "Suppressed lead.",
    leadFixtureId: "fixture-04-suppressed",
    lead: lead({ consentStatus: "granted", suppressed: true, phone: "+61400000004" }),
  }),
  base({
    scenarioId: "S05_owner_review_required",
    description: "Lead with owner review required.",
    leadFixtureId: "fixture-05-owner-review",
    lead: lead({ requiresOwnerReview: true, leadContext: "owner_review", phone: "+61400000005" }),
  }),
  base({
    scenarioId: "S06_existing_booking",
    description: "Lead with an existing booking.",
    leadFixtureId: "fixture-06-booked",
    lead: lead({ bookingStatus: "scheduled", leadContext: "booked_lead", phone: "+61400000006" }),
    gateOverrides: { hasConflictingBooking: true },
  }),
  base({
    scenarioId: "S07_prior_outbound_sms",
    description: "Lead with prior outbound SMS for the same intent.",
    leadFixtureId: "fixture-07-prior-outbound",
    lead: lead({ phone: "+61400000007" }),
    priorOutboundKeys: ["seq:00000000-0000-4000-8000-000000000001:fixture-07-prior-outbound:quote_chat_completion:step1"],
  }),
  base({
    scenarioId: "S08_quiet_hours",
    description: "Lead inside quiet hours.",
    leadFixtureId: "fixture-08-quiet-hours",
    lead: lead({ phone: "+61400000008" }),
    nowIso: LATE_NIGHT,
  }),
  base({
    scenarioId: "S09_over_cap",
    description: "Lead over daily and hourly cap.",
    leadFixtureId: "fixture-09-over-cap",
    lead: lead({ phone: "+61400000009" }),
    caps: { sentToday: 50, dailyCap: 50, sentThisHour: 10, hourlyCap: 10 },
  }),
  base({
    scenarioId: "S10_unknown_reachability",
    description: "Lead with unknown reachability.",
    leadFixtureId: "fixture-10-unknown-reachability",
    lead: lead({ reachable: false, phone: "+61400000010" }),
  }),
  base({
    scenarioId: "S11_approved_listed_service",
    description: "Approved, allow-listed service.",
    leadFixtureId: "fixture-11-listed-service",
    lead: lead({ phone: "+61400000011" }),
    approvedServiceName: "Full Interior Detail",
    requestedServiceName: "Full Interior Detail",
  }),
  base({
    scenarioId: "S12_unlisted_service",
    description: "Unlisted service requested.",
    leadFixtureId: "fixture-12-unlisted-service",
    lead: lead({ phone: "+61400000012" }),
    approvedServiceName: null,
    requestedServiceName: "Engine bay steam clean",
    serviceIsListed: false,
    serviceDurationMinutes: null,
  }),
  base({
    scenarioId: "S13_retry_same_intent",
    description: "Retry of the same execution intent.",
    leadFixtureId: "fixture-01-website-consented",
    replaysScenarioId: "S01_fresh_website_lead_consented",
  }),
  base({
    scenarioId: "S14_duplicate_provider_event",
    description: "Duplicate provider-event simulation.",
    leadFixtureId: "fixture-01-website-consented",
    replaysScenarioId: "S01_fresh_website_lead_consented",
    duplicateProviderEvent: true,
  }),
  base({
    scenarioId: "S15_booking_accepted",
    description: "Booking accepted from the offered fake slots.",
    leadFixtureId: "fixture-15-booking-accepted",
    lead: lead({ leadContext: "active_conversation", phone: "+61400000015", hasInboundReply: true }),
    bookingBehaviour: "accepted",
  }),
  base({
    scenarioId: "S16_booking_declined",
    description: "Booking declined — customer took no offered slot.",
    leadFixtureId: "fixture-16-booking-declined",
    lead: lead({ leadContext: "active_conversation", phone: "+61400000016", hasInboundReply: true }),
    bookingBehaviour: "declined",
  }),
  base({
    scenarioId: "S17_booking_commit_failure",
    description: "Booking commit failure — slot taken before commit.",
    leadFixtureId: "fixture-17-commit-failure",
    lead: lead({ leadContext: "active_conversation", phone: "+61400000017", hasInboundReply: true }),
    bookingBehaviour: "commit_failure",
  }),
  base({
    scenarioId: "S18_booking_commit_retry",
    description: "Booking commit retry after a failed commit.",
    leadFixtureId: "fixture-17-commit-failure",
    lead: lead({ leadContext: "active_conversation", phone: "+61400000017", hasInboundReply: true }),
    bookingBehaviour: "commit_retry",
    replaysScenarioId: "S17_booking_commit_failure",
  }),
];

export function findScenario(scenarioId: string): SandboxFixture | null {
  return SANDBOX_SCENARIOS.find((s) => s.scenarioId === scenarioId) ?? null;
}
