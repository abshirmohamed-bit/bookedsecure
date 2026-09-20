// Shared webhook safeguards: idempotency, fallback event hashing, tenant
// resolution and fail-closed logging. Provider-neutral.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Deterministic fallback event id for providers that do not supply one.
 * Two identical retried payloads produce the same fingerprint, so the
 * webhook_events unique index still suppresses the duplicate.
 */
export async function eventFingerprint(providerId: string, rawBody: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(`${providerId}|${rawBody}`, "utf8").digest("hex");
  return `hash:${digest.slice(0, 40)}`;
}

/** Provider event id when available, content hash otherwise. */
export async function resolveEventId(input: {
  providerId: string;
  eventId?: string | null;
  rawBody: string;
}): Promise<{ eventId: string; source: "provider" | "hash" }> {
  if (input.eventId && input.eventId.trim() !== "") {
    return { eventId: input.eventId, source: "provider" };
  }
  return { eventId: await eventFingerprint(input.providerId, input.rawBody), source: "hash" };
}

/** Postgres unique-violation. the only error that means "already recorded". */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code === "23505") return true;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && /duplicate key value|already exists/i.test(message);
}

/**
 * A claim older than this is assumed to belong to a worker that died mid-flight,
 * so another delivery may take it over. Comfortably longer than any handler.
 */
export const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export type WebhookEventState =
  /** This worker inserted the row and owns processing. */
  | "claimed"
  /** A previous attempt failed or died; this worker atomically took it over. */
  | "reclaimed"
  /** Already completed end-to-end: safe to acknowledge and stop. */
  | "duplicate_processed"
  /** Another worker holds a fresh claim: must NOT be acknowledged as done. */
  | "duplicate_in_progress";

export type WebhookRecordResult = {
  state?: WebhookEventState;
  /** The provider already sent this event: no processing required here. */
  duplicate: boolean;
  /** Persistence failed for a reason other than duplication: never acknowledge. */
  failed: boolean;
  reason?: string;
};

/** Diagnostics only: never persist payload bodies, numbers or credentials. */
function safeReason(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  const raw = typeof message === "string" ? message : String(error ?? "unknown");
  return raw.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Records the event and reports whether this caller owns processing.
 *
 * Insert-first, so the unique index on (provider, event_id). not application
 * state. is what guarantees exactly-once. Only a unique violation (23505) means
 * "already recorded"; any other database error is a real failure so the caller
 * can answer non-2xx and let the provider retry.
 *
 * A duplicate is resolved against the durable processing state: a row alone is
 * never proof that the event was successfully handled.
 */
export async function recordWebhookEvent(input: {
  providerId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  businessId?: string | null;
  signatureVerified: boolean;
}): Promise<WebhookRecordResult> {
  const { error } = await supabaseAdmin.from("webhook_events").insert({
    provider: input.providerId,
    event_id: input.eventId,
    event_type: input.eventType,
    payload: input.payload as never,
    business_id: input.businessId ?? null,
    signature_verified: input.signatureVerified,
    processing_started_at: new Date().toISOString(),
    processed_at: null,
  });
  if (!error) return { state: "claimed", duplicate: false, failed: false };
  if (isUniqueViolation(error)) return claimWebhookEvent(input.providerId, input.eventId);
  return { duplicate: false, failed: true, reason: safeReason(error) };
}

/**
 * Resolves a duplicate delivery. Completed events are acknowledged; an event a
 * live worker is still processing is reported as in-progress (non-2xx upstream);
 * a stale or failed claim is taken over with a single conditional UPDATE, which
 * is atomic in Postgres, so only one of several racing retries can win it.
 */
export async function claimWebhookEvent(
  providerId: string,
  eventId: string,
): Promise<WebhookRecordResult> {
  const { data: existing, error } = await supabaseAdmin
    .from("webhook_events")
    .select("processed_at, processing_started_at")
    .eq("provider", providerId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return { duplicate: false, failed: true, reason: safeReason(error) };
  if (!existing) return { duplicate: false, failed: true, reason: "event_row_missing" };
  if (existing.processed_at) {
    return { state: "duplicate_processed", duplicate: true, failed: false };
  }

  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const startedAt = existing.processing_started_at;
  if (startedAt && startedAt > cutoff) {
    return { state: "duplicate_in_progress", duplicate: true, failed: false };
  }

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("webhook_events")
    .update({ processing_started_at: new Date().toISOString(), processing_error: null })
    .eq("provider", providerId)
    .eq("event_id", eventId)
    .is("processed_at", null)
    .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
    .select("id");
  if (claimError) return { duplicate: false, failed: true, reason: safeReason(claimError) };
  if (!claimed || claimed.length === 0) {
    return { state: "duplicate_in_progress", duplicate: true, failed: false };
  }
  return { state: "reclaimed", duplicate: false, failed: false };
}

/**
 * Marks the event handled. only after message persistence, lead/conversation,
 * usage and audit work all succeeded. If the mark itself fails the caller must
 * not answer 2xx, otherwise a completed event could look unprocessed forever.
 */
export async function markWebhookProcessed(
  providerId: string,
  eventId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await supabaseAdmin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("provider", providerId)
    .eq("event_id", eventId);
  return error ? { ok: false, reason: safeReason(error) } : { ok: true };
}

/**
 * Leaves the event durably retryable: processed_at stays NULL and the claim is
 * cleared so the next delivery can take it over immediately.
 */
export async function markWebhookFailed(
  providerId: string,
  eventId: string,
  reason: unknown,
): Promise<void> {
  await supabaseAdmin
    .from("webhook_events")
    .update({ processing_error: safeReason(reason), processing_started_at: null })
    .eq("provider", providerId)
    .eq("event_id", eventId);
}


/**
 * Structured webhook logging. Never logs message bodies, credentials, or full
 * payloads. only routing metadata needed to diagnose delivery problems.
 */
export function logWebhook(
  level: "info" | "warn" | "error",
  providerId: string,
  detail: {
    outcome: string;
    eventType?: string | null;
    eventIdSource?: "provider" | "hash";
    businessId?: string | null;
    reason?: string | null;
  },
): void {
  const line = [
    `[sms:${providerId}]`,
    detail.outcome,
    detail.eventType ? `type=${detail.eventType}` : null,
    detail.eventIdSource ? `id=${detail.eventIdSource}` : null,
    detail.businessId ? `tenant=${detail.businessId}` : null,
    detail.reason ? `reason=${detail.reason}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
