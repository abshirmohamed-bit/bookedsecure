// Pure policy for owner-only PERMANENT deletion of already soft-deleted leads.
//
// SAFETY BOUNDARY: no IO here. This module only decides whether a lead may be
// permanently removed under the project's retention rules, which dependent
// records must be retained (detached, never destroyed), and what the
// confirmation dialog must show. Nothing here can send SMS, call a provider,
// run AI, or change automation settings.

import { importMethodLabel, leadSourceLabel } from "@/lib/lead-source";
import { maskPhone, normaliseSelection, type DeletableLead } from "@/lib/lead-deletion";

export { maskPhone, normaliseSelection };

/** The owner must type this exactly before the action is enabled. */
export const PURGE_CONFIRMATION_PHRASE = "DELETE";

export function isPurgeConfirmed(typed: string | null | undefined): boolean {
  return (typed ?? "").trim() === PURGE_CONFIRMATION_PHRASE;
}

/** Retention rules: records the project must keep are never destroyed. */
export const PURGE_BLOCK_REASONS = {
  not_found: "Lead not found for this business",
  not_soft_deleted: "Lead is still active. remove it from the inbox first",
  message_history: "Has SMS message history required for provider reconciliation",
  consent_history: "Has consent records required for compliance",
  financial_history: "Has job, booking or revenue records required for financial history",
  pending_automation: "Has a pending or in-flight automation job",
} as const;

export type PurgeBlockReason = keyof typeof PURGE_BLOCK_REASONS;

/** Dependencies which are retained by detaching them from the lead. */
export const PURGE_RETAINED_LABELS = {
  ai_usage_events: "AI usage attribution (detached, usage totals unchanged)",
  import_rows: "CRM import history (detached, batch records unchanged)",
  audit_events: "Audit trail (kept, including this deletion)",
} as const;

export type PurgeRetainedKind = keyof typeof PURGE_RETAINED_LABELS;

/** Dependent-record counts, gathered server-side immediately before deletion. */
export type LeadDependencies = {
  messages: number;
  consentEvents: number;
  jobs: number;
  pendingAutomationJobs: number;
  conversations: number;
  aiOutputs: number;
  notifications: number;
  aiUsageEvents: number;
  importRows: number;
};

export const EMPTY_DEPENDENCIES: LeadDependencies = {
  messages: 0,
  consentEvents: 0,
  jobs: 0,
  pendingAutomationJobs: 0,
  conversations: 0,
  aiOutputs: 0,
  notifications: 0,
  aiUsageEvents: 0,
  importRows: 0,
};

export const PENDING_AUTOMATION_STATUSES = new Set(["pending", "queued", "processing", "retrying"]);

export type PurgeEligibility = {
  leadId: string;
  allowed: boolean;
  blockedReasons: PurgeBlockReason[];
  retained: PurgeRetainedKind[];
  /** Cascade-removed alongside the lead when deletion is permitted. */
  removes: { conversations: number; aiOutputs: number; notifications: number; automationJobs: number };
};

export function evaluatePurgeEligibility(input: {
  leadId: string;
  lead: (DeletableLead & { deleted_at?: string | null }) | null;
  dependencies?: Partial<LeadDependencies>;
}): PurgeEligibility {
  const deps: LeadDependencies = { ...EMPTY_DEPENDENCIES, ...(input.dependencies ?? {}) };
  const blocked: PurgeBlockReason[] = [];

  if (!input.lead) blocked.push("not_found");
  else if (!input.lead.deleted_at) blocked.push("not_soft_deleted");

  if (deps.messages > 0) blocked.push("message_history");
  if (deps.consentEvents > 0) blocked.push("consent_history");
  if (deps.jobs > 0) blocked.push("financial_history");
  if (deps.pendingAutomationJobs > 0) blocked.push("pending_automation");

  const retained: PurgeRetainedKind[] = ["audit_events"];
  if (deps.aiUsageEvents > 0) retained.push("ai_usage_events");
  if (deps.importRows > 0) retained.push("import_rows");

  return {
    leadId: input.leadId,
    allowed: blocked.length === 0,
    blockedReasons: blocked,
    retained,
    removes: {
      conversations: deps.conversations,
      aiOutputs: deps.aiOutputs,
      notifications: deps.notifications,
      automationJobs: 0,
    },
  };
}

export function blockReasonText(reasons: PurgeBlockReason[]): string {
  return reasons.map((reason) => PURGE_BLOCK_REASONS[reason]).join(", ");
}

export function retainedText(retained: PurgeRetainedKind[]): string[] {
  return retained.map((kind) => PURGE_RETAINED_LABELS[kind]);
}

/* ------------------------------------------------------------------ planning */

export type PurgeOutcome = {
  leadId: string;
  name: string | null;
  status: "deleted" | "blocked";
  reason: string | null;
  retained: string[];
};

export type PurgePlan = {
  requestedCount: number;
  toPurge: string[];
  blocked: PurgeOutcome[];
  eligibility: PurgeEligibility[];
};

export function planPermanentDelete(input: {
  requestedIds: Iterable<string>;
  leads: (DeletableLead & { deleted_at?: string | null })[];
  dependenciesByLead?: Record<string, Partial<LeadDependencies>>;
}): PurgePlan {
  const ids = normaliseSelection(input.requestedIds);
  const byId = new Map(input.leads.map((lead) => [lead.id, lead]));
  const toPurge: string[] = [];
  const blocked: PurgeOutcome[] = [];
  const eligibility: PurgeEligibility[] = [];

  for (const id of ids) {
    const lead = byId.get(id) ?? null;
    const result = evaluatePurgeEligibility({
      leadId: id,
      lead,
      ...(input.dependenciesByLead?.[id] ? { dependencies: input.dependenciesByLead[id] } : {}),
    });
    eligibility.push(result);
    if (result.allowed) toPurge.push(id);
    else
      blocked.push({
        leadId: id,
        name: lead?.name ?? null,
        status: "blocked",
        reason: blockReasonText(result.blockedReasons),
        retained: retainedText(result.retained),
      });
  }

  return { requestedCount: ids.length, toPurge, blocked, eligibility };
}

/* -------------------------------------------------------------- confirmation */

export type PurgeConfirmationRow = {
  id: string;
  name: string;
  phone: string | null;
  source: string;
  importMethod: string | null;
};

export type PurgeConfirmation = {
  count: number;
  rows: PurgeConfirmationRow[];
  warning: string;
  buttonLabel: string;
};

export const PURGE_WARNING =
  "Permanent deletion cannot be undone. These leads will be erased from the database and cannot be restored. They will also stop counting towards duplicate protection, so the same customer could be imported or re-enquire as a new lead. Messages, consent records, jobs and revenue are never destroyed. a lead holding any of those is blocked instead.";

export function purgeButtonLabel(count: number): string {
  return `Permanently delete ${count} ${count === 1 ? "lead" : "leads"}`;
}

export function buildPurgeConfirmation(
  selection: Iterable<string>,
  leads: DeletableLead[],
): PurgeConfirmation {
  const ids = normaliseSelection(selection);
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((lead): lead is DeletableLead => Boolean(lead))
    .map((lead) => ({
      id: lead.id,
      name: lead.name?.trim() || "Unnamed lead",
      phone: maskPhone(lead.mobile_number),
      source: leadSourceLabel(lead),
      importMethod: importMethodLabel(lead),
    }));
  return {
    count: rows.length,
    rows,
    warning: PURGE_WARNING,
    buttonLabel: purgeButtonLabel(rows.length),
  };
}

/* ------------------------------------------------------------------- results */

export type PurgeResult = {
  requestId: string;
  requested: number;
  deleted: number;
  blocked: number;
  outcomes: PurgeOutcome[];
  idempotentReplay: boolean;
};

export function summarisePurgeResult(result: PurgeResult): string {
  const parts = [
    `${result.requested} selected`,
    `${result.deleted} permanently deleted`,
    `${result.blocked} blocked`,
  ];
  if (result.idempotentReplay) parts.push("repeat request. nothing new deleted");
  return parts.join(" · ");
}
