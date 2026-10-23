// Pure logic for safe, recoverable lead deletion.
//
// SAFETY BOUNDARY: nothing here performs IO. It only decides which of the
// leads the operator selected may be soft-deleted, what the confirmation
// dialog must show, and how the result is summarised. No hard deletes are ever
// planned, and no related record (conversation, message, job, notification,
// webhook event, import batch, commit/idempotency key) is ever included.

import { leadSourceLabel, importMethodLabel, type AttributableLead } from "@/lib/lead-source";

export type DeletableLead = AttributableLead & {
  id: string;
  name?: string | null;
  mobile_number?: string | null;
  deleted_at?: string | null;
  conversation?: {
    status?: unknown;
    automation_paused?: unknown;
    next_follow_up_at?: unknown;
  } | null;
  job?: {
    completion_status?: unknown;
    completed_value?: unknown;
  } | null;
};

/* ------------------------------------------------------------------ selection */

/** Selections are always a de-duplicated set of ids. */
export function normaliseSelection(ids: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(ids).filter((id) => typeof id === "string" && id !== "")));
}

/** Adds or removes a single lead from the selection. */
export function toggleSelection(selection: Iterable<string>, leadId: string): string[] {
  const set = new Set(normaliseSelection(selection));
  if (set.has(leadId)) set.delete(leadId);
  else set.add(leadId);
  return Array.from(set);
}

/**
 * Select-all is scoped to the rows currently visible after filtering, and
 * leaves any previously selected id that is no longer visible untouched only
 * when it is still part of the visible set. hidden rows are never added.
 */
export function selectAllVisible(visible: { id: string }[]): string[] {
  return normaliseSelection(visible.map((row) => row.id));
}

/** Drops ids that are no longer in the filtered result, so counts stay honest. */
export function restrictToVisible(selection: Iterable<string>, visible: { id: string }[]): string[] {
  const visibleIds = new Set(visible.map((row) => row.id));
  return normaliseSelection(selection).filter((id) => visibleIds.has(id));
}

export function clearSelection(): string[] {
  return [];
}

export type HeaderCheckboxState = "unchecked" | "indeterminate" | "checked";

export function headerCheckboxState(
  selection: Iterable<string>,
  visible: { id: string }[],
): HeaderCheckboxState {
  const selected = restrictToVisible(selection, visible).length;
  if (selected === 0 || visible.length === 0) return "unchecked";
  return selected === visible.length ? "checked" : "indeterminate";
}

/* ---------------------------------------------------------------- eligibility */

export const DELETION_BLOCK_REASONS = {
  completed_job: "Has a completed job",
  recorded_revenue: "Has recorded revenue",
  active_conversation: "Has an active conversation",
  pending_action: "Has a pending operational action",
  reconciliation_issue: "Has a provider or webhook reconciliation issue",
} as const;

export type DeletionBlockReason = keyof typeof DELETION_BLOCK_REASONS;

const ACTIVE_CONVERSATION_STATUSES = new Set(["active", "awaiting_reply", "in_progress", "open"]);

export type LeadEligibility = {
  leadId: string;
  protectedReasons: DeletionBlockReason[];
  alreadyDeleted: boolean;
};

/**
 * Flags operational history worth protecting. Protected leads are never
 * silently deleted: the caller must pass an explicit extra confirmation.
 */
export function leadEligibility(lead: DeletableLead): LeadEligibility {
  const reasons: DeletionBlockReason[] = [];
  const job = lead.job ?? null;
  if (job?.completion_status === "completed") reasons.push("completed_job");
  if (Number(job?.completed_value ?? 0) > 0) reasons.push("recorded_revenue");

  const conversation = lead.conversation ?? null;
  if (conversation) {
    const status = typeof conversation.status === "string" ? conversation.status : "";
    if (ACTIVE_CONVERSATION_STATUSES.has(status)) reasons.push("active_conversation");
    if (conversation.next_follow_up_at) reasons.push("pending_action");
  }

  return {
    leadId: lead.id,
    protectedReasons: Array.from(new Set(reasons)),
    alreadyDeleted: Boolean(lead.deleted_at),
  };
}

export function isProtected(lead: DeletableLead): boolean {
  return leadEligibility(lead).protectedReasons.length > 0;
}

/* --------------------------------------------------------------- confirmation */

/** Masks all but the last three digits so full numbers are never logged. */
export function maskPhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `••• ••• ${digits.slice(-3)}`;
}

export type ConfirmationRow = {
  id: string;
  name: string;
  phone: string | null;
  source: string;
  importMethod: string | null;
  protectedReasons: string[];
};

export type ConfirmationSummary = {
  count: number;
  rows: ConfirmationRow[];
  protectedCount: number;
  buttonLabel: string;
  warning: string;
};

export function confirmButtonLabel(count: number): string {
  return `Delete ${count} ${count === 1 ? "lead" : "leads"}`;
}

export function buildConfirmation(
  selection: Iterable<string>,
  leads: DeletableLead[],
): ConfirmationSummary {
  const ids = normaliseSelection(selection);
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const rows: ConfirmationRow[] = ids
    .map((id) => byId.get(id))
    .filter((lead): lead is DeletableLead => Boolean(lead))
    .map((lead) => {
      const eligibility = leadEligibility(lead);
      return {
        id: lead.id,
        name: lead.name?.trim() || "Unnamed lead",
        phone: maskPhone(lead.mobile_number),
        source: leadSourceLabel(lead),
        importMethod: importMethodLabel(lead),
        protectedReasons: eligibility.protectedReasons.map(
          (reason) => DELETION_BLOCK_REASONS[reason],
        ),
      };
    });

  return {
    count: rows.length,
    rows,
    protectedCount: rows.filter((row) => row.protectedReasons.length > 0).length,
    buttonLabel: confirmButtonLabel(rows.length),
    warning:
      "This removes the selected leads from the active Leads inbox. Conversations, messages, jobs, revenue and import history are preserved and the leads stay recoverable.",
  };
}

/* -------------------------------------------------------------------- planning */

export type DeletionFailure = { leadId: string; name: string | null; reason: string };

export type DeletionPlan = {
  requestedCount: number;
  toDelete: string[];
  alreadyDeleted: string[];
  failures: DeletionFailure[];
};

/**
 * Decides what a soft-delete request should actually do.
 *
 * - ids that do not belong to the tenant fail (never touched)
 * - ids already soft-deleted are idempotent no-ops, not failures
 * - protected leads fail unless `allowProtected` was explicitly confirmed
 */
export function planSoftDelete(input: {
  requestedIds: Iterable<string>;
  tenantLeads: DeletableLead[];
  allowProtected?: boolean;
}): DeletionPlan {
  const ids = normaliseSelection(input.requestedIds);
  const byId = new Map(input.tenantLeads.map((lead) => [lead.id, lead]));
  const toDelete: string[] = [];
  const alreadyDeleted: string[] = [];
  const failures: DeletionFailure[] = [];

  for (const id of ids) {
    const lead = byId.get(id);
    if (!lead) {
      failures.push({ leadId: id, name: null, reason: "Lead not found for this business" });
      continue;
    }
    const eligibility = leadEligibility(lead);
    if (eligibility.alreadyDeleted) {
      alreadyDeleted.push(id);
      continue;
    }
    if (eligibility.protectedReasons.length > 0 && !input.allowProtected) {
      failures.push({
        leadId: id,
        name: lead.name ?? null,
        reason: eligibility.protectedReasons
          .map((reason) => DELETION_BLOCK_REASONS[reason])
          .join(", "),
      });
      continue;
    }
    toDelete.push(id);
  }

  return { requestedCount: ids.length, toDelete, alreadyDeleted, failures };
}

export type DeletionResult = {
  requestId: string;
  requested: number;
  deleted: number;
  failed: number;
  failures: DeletionFailure[];
  alreadyDeleted: number;
  idempotentReplay: boolean;
};

export function summariseResult(result: DeletionResult): string {
  const parts = [
    `${result.requested} requested`,
    `${result.deleted} deleted`,
    `${result.failed} failed`,
  ];
  if (result.alreadyDeleted > 0) parts.push(`${result.alreadyDeleted} already removed`);
  if (result.idempotentReplay) parts.push("repeat request. no new deletions");
  return parts.join(" · ");
}

/** Active inbox rows: soft-deleted leads never appear. */
export function activeLeads<T extends { deleted_at?: string | null }>(leads: T[]): T[] {
  return leads.filter((lead) => !lead.deleted_at);
}
