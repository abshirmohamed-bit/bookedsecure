/**
 * Historical outbound SMS attribution.
 *
 * Read-only classification of legacy messages that carry no `message_source`.
 * Attribution is evidence-driven only: a category is assigned when, and only
 * when, an existing trigger record links the message to it. Message body,
 * phone number, timing, delivery receipts, replies and current lead state are
 * NEVER treated as proof.
 */

export type MessageSourceCategory =
  | "manual"
  | "quote_page"
  | "inbound_follow_up"
  | "automation"
  | "imported_historical"
  | "unknown";

export type AttributionConfidence = "deterministic" | "unresolved";

/** Existing records considered as evidence for one message. */
export type AttributionEvidence = {
  /** Automation job rows whose (business_id, idempotency_key) equals the message's. */
  automationJobKeyMatches: number;
  /** Audit events that name this message id explicitly (metadata.message_id / entity_id). */
  auditEventsNamingMessage: Array<{ id: string; event_type: string }>;
  /** Manual-send audit events for the same tenant + lead that do NOT name a message id. */
  unlinkedManualSendAuditEvents: number;
  /** Staged import rows that produced this message (import-originated sends). */
  importSendRecords: number;
};

export type AttributableMessage = {
  id: string;
  business_id: string;
  lead_id: string | null;
  direction: string;
  message_kind: string | null;
  message_source: string | null;
  idempotency_key: string | null;
};

export type AttributionProposal = {
  messageId: string;
  businessId: string;
  currentSource: string | null;
  proposedSource: MessageSourceCategory;
  confidence: AttributionConfidence;
  proof: string[];
  conflict: boolean;
  conflictDetail?: string | undefined;
  updateAllowed: boolean;
};

const MANUAL_AUDIT_TYPES = new Set(["sms_sent_manual"]);

/**
 * Classify a single message from existing records.
 * Never mutates anything; the caller decides whether to persist.
 */
export function proposeAttribution(
  message: AttributableMessage,
  evidence: AttributionEvidence,
): AttributionProposal {
  const proof: string[] = [];
  const base = {
    messageId: message.id,
    businessId: message.business_id,
    currentSource: message.message_source ?? null,
  };

  const unresolved = (reason: string, conflict = false, conflictDetail?: string): AttributionProposal => ({
    ...base,
    proposedSource: "unknown",
    confidence: "unresolved",
    proof: [reason],
    conflict,
    conflictDetail,
    updateAllowed: false,
  });

  // Already attributed: never rewrite an existing attribution.
  if (message.message_source) {
    return {
      ...base,
      proposedSource: message.message_source as MessageSourceCategory,
      confidence: "deterministic",
      proof: ["messages.message_source already set"],
      conflict: false,
      updateAllowed: false,
    };
  }

  // Inbound messages have no outbound trigger to attribute.
  if (message.direction !== "outbound") {
    return unresolved("inbound message: no outbound trigger record applies");
  }

  const candidates: MessageSourceCategory[] = [];

  if (evidence.automationJobKeyMatches === 1) {
    candidates.push("automation");
    proof.push("automation_jobs row with identical (business_id, idempotency_key)");
  } else if (evidence.automationJobKeyMatches > 1) {
    return unresolved(
      "multiple automation_jobs rows share this idempotency key",
      true,
      `${evidence.automationJobKeyMatches} automation job matches`,
    );
  }

  if (evidence.importSendRecords > 0) {
    candidates.push("imported_historical");
    proof.push("lead_import_rows send record links this message to a staged import");
  }

  const namedManual = evidence.auditEventsNamingMessage.filter(
    (event) => MANUAL_AUDIT_TYPES.has(event.event_type) || event.event_type.startsWith("internal_test"),
  );
  if (message.message_kind === "manual") {
    candidates.push("manual");
    proof.push("messages.message_kind = 'manual' recorded by the manual send path");
    if (namedManual.length > 0) {
      proof.push(`audit_events naming this message: ${namedManual.map((e) => e.event_type).join(", ")}`);
    } else if (evidence.unlinkedManualSendAuditEvents === 0) {
      proof.push("no manual-send audit event references this message");
    }
  }

  const distinct = Array.from(new Set(candidates));
  if (distinct.length === 0) {
    return unresolved("no trigger record links this message to any category");
  }
  if (distinct.length > 1) {
    return unresolved(
      "multiple source records could explain this message",
      true,
      `candidates: ${distinct.join(", ")}`,
    );
  }

  return {
    ...base,
    proposedSource: distinct[0]!,
    confidence: "deterministic",
    proof,
    conflict: false,
    updateAllowed: true,
  };
}

export function summariseProposals(proposals: AttributionProposal[]) {
  const byCategory: Record<string, number> = {};
  let attributable = 0;
  let unattributed = 0;
  let conflicts = 0;
  for (const proposal of proposals) {
    if (proposal.updateAllowed) {
      attributable += 1;
      byCategory[proposal.proposedSource] = (byCategory[proposal.proposedSource] ?? 0) + 1;
    } else if (!proposal.currentSource) {
      unattributed += 1;
      byCategory["unknown"] = (byCategory["unknown"] ?? 0) + 1;
    }
    if (proposal.conflict) conflicts += 1;
  }
  return { total: proposals.length, attributable, unattributed, conflicts, byCategory };
}
