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

/**
 * Records the event and reports whether it is a duplicate. Insert-first, so the
 * unique index — not application state — is what guarantees exactly-once.
 */
export async function recordWebhookEvent(input: {
  providerId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  businessId?: string | null;
  signatureVerified: boolean;
}): Promise<{ duplicate: boolean }> {
  const { error } = await supabaseAdmin.from("webhook_events").insert({
    provider: input.providerId,
    event_id: input.eventId,
    event_type: input.eventType,
    payload: input.payload as never,
    business_id: input.businessId ?? null,
    signature_verified: input.signatureVerified,
  });
  return { duplicate: Boolean(error) };
}

/**
 * Structured webhook logging. Never logs message bodies, credentials, or full
 * payloads — only routing metadata needed to diagnose delivery problems.
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
