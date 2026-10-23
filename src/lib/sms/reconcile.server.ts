// Read-only delivery reconciliation.
//
// Telnyx exposes GET /v2/messages/{id}, so a message whose receipt never arrived
// can be re-checked against the provider. This path:
//   * is tenant-scoped (the message must belong to the caller's business)
//   * only ever performs a GET. it never resends, never creates a message,
//     never touches the body or recipient, and never triggers automation
//   * routes the result through the same transition gate, so it is idempotent
//     and cannot downgrade a terminal state
//
// Providers without a lookup capability are reported as unsupported, never faked.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isPendingStatus } from "./delivery";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export type ReconcileResult = {
  checked: number;
  updated: number;
  unsupported?: boolean;
  reason?: string;
  results: Array<{
    messageId: string;
    previousStatus: string;
    providerStatus: string | null;
    applied: boolean;
    reason?: string;
  }>;
};

/** True only for providers where a read-only message lookup exists today. */
export function supportsLookup(provider: string | null | undefined): boolean {
  return provider === "telnyx";
}

async function lookupTelnyxMessage(providerMessageId: string): Promise<{
  ok: boolean;
  status: string | null;
  errorCode: string | null;
  occurredAt: string | null;
  reason?: string;
}> {
  const apiKey = process.env["TELNYX_API_KEY"];
  if (!apiKey) return { ok: false, status: null, errorCode: null, occurredAt: null, reason: "telnyx_not_connected" };

  const response = await fetch(`${TELNYX_API_BASE}/messages/${encodeURIComponent(providerMessageId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[sms:telnyx] lookup failed [${response.status}]`);
    return {
      ok: false,
      status: null,
      errorCode: null,
      occurredAt: null,
      reason: `lookup_failed_${response.status}`,
    };
  }
  const { flattenTelnyxPayload } = await import("./telnyx.server");
  const flat = flattenTelnyxPayload(JSON.parse(text || "{}") as Record<string, unknown>);
  return { ok: true, status: flat.status, errorCode: flat.errorCode, occurredAt: flat.occurredAt };
}

/**
 * Reconciles pending outbound messages for one business. `messageId` narrows it
 * to a single message; otherwise the oldest pending messages are checked.
 */
export async function reconcileDeliveryStatuses(input: {
  businessId: string;
  messageId?: string | null;
  limit?: number;
}): Promise<ReconcileResult> {
  const query = supabaseAdmin
    .from("messages")
    .select("id, provider, provider_message_id, delivery_status")
    .eq("business_id", input.businessId)
    .eq("direction", "outbound")
    .not("provider_message_id", "is", null);

  const { data: rows } = input.messageId
    ? await query.eq("id", input.messageId)
    : await query.order("created_at", { ascending: true }).limit(input.limit ?? 25);

  const candidates = (rows ?? []).filter((row) => isPendingStatus(row.delivery_status));
  const results: ReconcileResult["results"] = [];
  let updated = 0;

  const { applyDeliveryEvent } = await import("./delivery.server");
  const { mapTelnyxStatus } = await import("./telnyx.server");

  for (const row of candidates) {
    if (!supportsLookup(row.provider)) {
      results.push({
        messageId: row.id,
        previousStatus: row.delivery_status,
        providerStatus: null,
        applied: false,
        reason: "provider_lookup_unsupported",
      });
      continue;
    }

    const lookup = await lookupTelnyxMessage(row.provider_message_id!);
    if (!lookup.ok) {
      results.push({
        messageId: row.id,
        previousStatus: row.delivery_status,
        providerStatus: null,
        applied: false,
        ...(lookup.reason ? { reason: lookup.reason } : {}),
      });
      continue;
    }

    const applied = await applyDeliveryEvent({
      providerName: "telnyx",
      businessId: input.businessId,
      providerMessageId: row.provider_message_id!,
      status: mapTelnyxStatus(lookup.status),
      rawStatus: lookup.status,
      failureCode: lookup.errorCode,
      occurredAt: lookup.occurredAt,
      eventId: `reconcile:${row.provider_message_id}:${lookup.status ?? "unknown"}`,
      reconciliation: true,
    });
    if (applied.applied) updated += 1;
    results.push({
      messageId: row.id,
      previousStatus: row.delivery_status,
      providerStatus: lookup.status,
      applied: applied.applied,
      ...(applied.reason ? { reason: applied.reason } : {}),
    });
  }

  return { checked: candidates.length, updated, results };
}
