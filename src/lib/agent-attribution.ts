/**
 * Phase 4 step 2 — attribution only.
 *
 * Pure helpers that turn optional agent attribution into the persisted
 * columns on `messages` and `automation_jobs`. Attribution is metadata: this
 * module can never send, enqueue, book, notify, enrol a lead, activate a
 * campaign or change `current_sequence`. There is no I/O here at all.
 *
 * Invariants:
 * - Every field is optional. Callers that pass nothing get exactly the legacy
 *   behaviour, including a `null` for every attribution column.
 * - `message_source = "agent_sequence"` is only ever produced when a caller
 *   explicitly supplies it; no derivation can ever return it.
 * - Malformed references (blank strings, non-uuid action ids) are rejected as
 *   invalid instead of being silently persisted.
 */

/** Kinds of action an agent sequence step may be attributed to. */
export const AGENT_ACTION_KINDS = [
  "send_sms",
  "capture_consent",
  "handoff",
  "none_no_outbound",
] as const;

export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

/** Optional attribution accepted by the existing SMS and job paths. */
export type AgentAttributionInput = {
  sequenceId?: string | null | undefined;
  actionKind?: string | null | undefined;
  agentActionId?: string | null | undefined;
  templateId?: string | null | undefined;
};

export type NormalisedAgentAttribution = {
  sequenceId: string | null;
  actionKind: AgentActionKind | null;
  agentActionId: string | null;
  templateId: string | null;
  /** True when at least one attribution field was supplied and valid. */
  present: boolean;
};

export type AttributionValidation =
  | { ok: true; attribution: NormalisedAgentAttribution }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY: NormalisedAgentAttribution = {
  sequenceId: null,
  actionKind: null,
  agentActionId: null,
  templateId: null,
  present: false,
};

function text(value: string | null | undefined): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "invalid";
  if (trimmed.length > 120) return "invalid";
  return trimmed;
}

/**
 * Validates optional attribution. Absent attribution is valid and yields the
 * empty record, so existing callers are unaffected.
 */
export function normaliseAgentAttribution(
  input: AgentAttributionInput | null | undefined,
): AttributionValidation {
  if (!input) return { ok: true, attribution: EMPTY };

  const sequenceId = text(input.sequenceId);
  if (sequenceId === "invalid") return { ok: false, reason: "Invalid sequence attribution." };

  const templateId = text(input.templateId);
  if (templateId === "invalid") return { ok: false, reason: "Invalid template attribution." };

  const rawKind = text(input.actionKind);
  if (rawKind === "invalid") return { ok: false, reason: "Invalid action kind attribution." };
  if (rawKind !== null && !AGENT_ACTION_KINDS.includes(rawKind as AgentActionKind)) {
    return { ok: false, reason: `Unknown agent action kind "${rawKind}".` };
  }
  const actionKind = (rawKind as AgentActionKind | null) ?? null;

  const rawActionId = text(input.agentActionId);
  if (rawActionId === "invalid") return { ok: false, reason: "Invalid agent action reference." };
  if (rawActionId !== null && !UUID.test(rawActionId)) {
    return { ok: false, reason: "Invalid agent action reference." };
  }
  const agentActionId = rawActionId;

  const present =
    sequenceId !== null || actionKind !== null || agentActionId !== null || templateId !== null;

  return {
    ok: true,
    attribution: { sequenceId, actionKind, agentActionId, templateId, present },
  };
}

/** Columns written on `messages`. Always explicit, never partial. */
export function messageAttributionColumns(attribution: NormalisedAgentAttribution): {
  sequence_id: string | null;
  agent_action_id: string | null;
  template_id: string | null;
} {
  return {
    sequence_id: attribution.sequenceId,
    agent_action_id: attribution.agentActionId,
    template_id: attribution.templateId,
  };
}

/** Columns written on `automation_jobs`. */
export function jobAttributionColumns(attribution: NormalisedAgentAttribution): {
  sequence_id: string | null;
  agent_action_id: string | null;
  sequence_step_template_id: string | null;
} {
  return {
    sequence_id: attribution.sequenceId,
    agent_action_id: attribution.agentActionId,
    sequence_step_template_id: attribution.templateId,
  };
}

/**
 * Attribution carried in a job payload, so a job created with attribution
 * hands the same values to the SMS path when it later runs.
 */
export function attributionFromJobRow(row: {
  sequence_id?: string | null;
  agent_action_id?: string | null;
  sequence_step_template_id?: string | null;
}): AgentAttributionInput {
  return {
    sequenceId: row.sequence_id ?? null,
    agentActionId: row.agent_action_id ?? null,
    templateId: row.sequence_step_template_id ?? null,
  };
}

/**
 * Attribution NEVER authorises a send. Step 2 has no executor: this predicate
 * exists so tests can assert that carrying attribution does not activate
 * anything.
 */
export function attributionAuthorisesSend(): false {
  return false;
}
