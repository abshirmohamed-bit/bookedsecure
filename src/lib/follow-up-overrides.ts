/**
 * Per-lead follow-up overrides.
 *
 * The business-wide sequence lives in `automation_rules`. A tenant can tailor
 * one customer's steps without touching that shared sequence: the overrides
 * are stored on that customer's conversation, keyed by step number, and only
 * the fields that were set win over the shared rule.
 */

export type FollowUpStepOverride = {
  delay_minutes?: number;
  message_template?: string;
};

export type FollowUpOverrides = Record<string, FollowUpStepOverride>;

/** One week in minutes: the most a single follow-up can be pushed out. */
export const MAX_FOLLOW_UP_DELAY_MINUTES = 7 * 24 * 60;

/** Reads a stored overrides blob defensively; anything malformed is ignored. */
export function parseFollowUpOverrides(raw: unknown): FollowUpOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FollowUpOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const override: FollowUpStepOverride = {};
    if (
      typeof entry["delay_minutes"] === "number" &&
      Number.isFinite(entry["delay_minutes"]) &&
      entry["delay_minutes"] >= 0
    ) {
      override.delay_minutes = Math.min(MAX_FOLLOW_UP_DELAY_MINUTES, Math.round(entry["delay_minutes"]));
    }
    if (typeof entry["message_template"] === "string" && entry["message_template"].trim()) {
      override.message_template = entry["message_template"].trim();
    }
    if (override.delay_minutes !== undefined || override.message_template !== undefined) {
      out[key] = override;
    }
  }
  return out;
}

/** The shared rule with this lead's own wording/timing laid over it. */
export function resolveFollowUpStep<T extends { step: number; delay_minutes?: number; message_template?: string }>(
  rule: T,
  overrides: FollowUpOverrides,
): T & { overridden: boolean } {
  const override = overrides[String(rule.step)];
  if (!override) return { ...rule, overridden: false };
  return {
    ...rule,
    ...(override.delay_minutes !== undefined ? { delay_minutes: override.delay_minutes } : {}),
    ...(override.message_template !== undefined ? { message_template: override.message_template } : {}),
    overridden: true,
  };
}

/** Merges one step change into the stored overrides; `null` fields clear. */
export function mergeFollowUpOverride(
  current: FollowUpOverrides,
  step: number,
  change: { delay_minutes?: number | null; message_template?: string | null },
): FollowUpOverrides {
  const key = String(step);
  const next: FollowUpStepOverride = { ...(current[key] ?? {}) };
  if (change.delay_minutes === null) delete next.delay_minutes;
  else if (typeof change.delay_minutes === "number") {
    next.delay_minutes = Math.min(MAX_FOLLOW_UP_DELAY_MINUTES, Math.max(0, Math.round(change.delay_minutes)));
  }
  if (change.message_template === null) delete next.message_template;
  else if (typeof change.message_template === "string" && change.message_template.trim()) {
    next.message_template = change.message_template.trim();
  }
  const out = { ...current };
  if (next.delay_minutes === undefined && next.message_template === undefined) delete out[key];
  else out[key] = next;
  return out;
}
