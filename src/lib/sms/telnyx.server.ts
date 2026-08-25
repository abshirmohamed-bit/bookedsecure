// Telnyx v2 Messages API adapter. Lives behind the shared SmsProvider
// interface, so nothing outside src/lib/sms knows Telnyx exists.
//
// Phase 1: adapter + webhook plumbing only. No number is provisioned, no
// business is switched to this provider, and Twilio/simulated paths are
// untouched.

import type {
  DeliveryStatusUpdate,
  InboundMessage,
  SendResult,
  SmsProvider,
  WebhookVerification,
} from "./provider.server";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

/** Telnyx message statuses -> internal delivery statuses. */
const TELNYX_STATUS_MAP: Record<string, SendResult["deliveryStatus"]> = {
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  sending_failed: "failed",
  delivery_failed: "undelivered",
  expired: "undelivered",
  // Inbound-only status Telnyx reports on received messages.
  received: "delivered",
};

export function mapTelnyxStatus(raw: unknown): SendResult["deliveryStatus"] {
  if (typeof raw !== "string" || raw.length === 0) return "unknown";
  return TELNYX_STATUS_MAP[raw.toLowerCase()] ?? "unknown";
}

export type FlatTelnyxEvent = {
  eventType: string | null;
  eventId: string | null;
  occurredAt: string | null;
  messageId: string | null;
  from: string | null;
  to: string | null;
  text: string;
  status: string | null;
  errorCode: string | null;
  cost: number | null;
  direction: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function phone(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const record = asRecord(value);
  const number = record["phone_number"];
  return typeof number === "string" && number.length > 0 ? number : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.abs(Number(value));
  }
  return null;
}

/**
 * Telnyx nests everything under `data.payload`, with `to` as an array of
 * recipients each carrying its own status. Flatten to one shape the engine can
 * consume, accepting an already-flattened payload too (tests, replays).
 */
export function flattenTelnyxPayload(raw: Record<string, unknown>): FlatTelnyxEvent {
  const data = asRecord(raw["data"] ?? raw);
  const payload = asRecord(data["payload"] ?? data);

  const toList = Array.isArray(payload["to"]) ? (payload["to"] as unknown[]) : [];
  const firstTo = toList[0];
  const toRecord = asRecord(firstTo);

  const errors = Array.isArray(payload["errors"]) ? (payload["errors"] as unknown[]) : [];
  const firstError = asRecord(errors[0]);
  const errorCode =
    firstError["code"] !== undefined && firstError["code"] !== null
      ? String(firstError["code"])
      : null;

  const cost = asRecord(payload["cost"] ?? payload["completed_at_cost"]);

  return {
    eventType: typeof data["event_type"] === "string" ? data["event_type"] : null,
    eventId: typeof data["id"] === "string" ? data["id"] : null,
    occurredAt:
      typeof data["occurred_at"] === "string"
        ? data["occurred_at"]
        : typeof payload["received_at"] === "string"
          ? (payload["received_at"] as string)
          : typeof payload["sent_at"] === "string"
            ? (payload["sent_at"] as string)
            : null,
    messageId: typeof payload["id"] === "string" ? payload["id"] : null,
    from: phone(payload["from"]),
    to: phone(firstTo) ?? phone(payload["to"]),
    text: typeof payload["text"] === "string" ? payload["text"] : "",
    status:
      (typeof toRecord["status"] === "string" ? (toRecord["status"] as string) : null) ??
      (typeof payload["status"] === "string" ? (payload["status"] as string) : null),
    errorCode,
    cost: numeric(cost["amount"]),
    direction: typeof payload["direction"] === "string" ? payload["direction"] : null,
  };
}

/** Request body sent to POST /v2/messages. E.164 numbers only. */
export function buildTelnyxSendPayload(input: {
  to: string;
  from: string;
  body: string;
  messagingProfileId?: string | null;
  webhookUrl?: string | null;
}): Record<string, string> {
  const payload: Record<string, string> = {
    from: normaliseE164(input.from),
    to: normaliseE164(input.to),
    text: input.body,
  };
  if (input.messagingProfileId) payload["messaging_profile_id"] = input.messagingProfileId;
  if (input.webhookUrl) payload["webhook_url"] = input.webhookUrl;
  return payload;
}

export function normaliseE164(number: string): string {
  const digits = number.replace(/[^\d]/g, "");
  return number.trim().startsWith("+") ? `+${digits}` : `+${digits}`;
}

/**
 * Telnyx signs webhooks with Ed25519 over `timestamp|rawBody`, sending the
 * base64 signature in `telnyx-signature-ed25519` and the unix seconds in
 * `telnyx-timestamp`. The public key comes from the Telnyx portal.
 */
export async function verifyTelnyxSignature(input: {
  headers: Headers;
  rawBody: string;
  publicKeyBase64: string;
  toleranceSeconds?: number;
}): Promise<WebhookVerification> {
  const signature = input.headers.get("telnyx-signature-ed25519");
  const timestamp = input.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) {
    return { verified: false, reason: "Missing Telnyx signature headers." };
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (input.toleranceSeconds ?? 300)) {
    return { verified: false, reason: "Telnyx timestamp outside tolerance." };
  }

  const { createPublicKey, verify } = await import("node:crypto");
  try {
    // Wrap the raw 32-byte Ed25519 key in a minimal SPKI header.
    const raw = Buffer.from(input.publicKeyBase64, "base64");
    if (raw.length !== 32) return { verified: false, reason: "Malformed Telnyx public key." };
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      raw,
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const ok = verify(
      null,
      Buffer.from(`${timestamp}|${input.rawBody}`, "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
    return ok ? { verified: true } : { verified: false, reason: "Invalid Telnyx signature." };
  } catch (error) {
    return {
      verified: false,
      reason: `Telnyx signature check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Production means: deployed runtime, not a test run and not `vite dev`.
 * Anything else (local dev, vitest) may use the shared-secret fallback.
 */
export function isProductionRuntime(): boolean {
  const env = process.env["NODE_ENV"];
  if (env === "test" || process.env["VITEST"]) return false;
  return env === "production";
}



export function createTelnyxProvider(deps: {
  verifySharedSecret: (headers: Headers, url: string) => Promise<WebhookVerification>;
}): SmsProvider {
  return {
    name: "telnyx",

    async sendMessage({ to, body, sender }) {
      const apiKey =
        sender.credentialMode === "byo" && sender.credentialSecretName
          ? process.env[sender.credentialSecretName]
          : process.env["TELNYX_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "Telnyx is not connected yet. Add a Telnyx API key or use the simulated provider.",
        );
      }

      const publicBase = process.env["PUBLIC_APP_URL"];
      const webhookSecret = process.env["SMS_WEBHOOK_SECRET"];
      const webhookUrl =
        publicBase && webhookSecret
          ? `${publicBase.replace(/\/$/, "")}/api/public/sms/telnyx?t=${encodeURIComponent(webhookSecret)}`
          : null;

      const payload = buildTelnyxSendPayload({
        to,
        from: sender.phoneNumber,
        body,
        messagingProfileId: sender.messagingProfileId ?? null,
        webhookUrl,
      });

      const response = await fetch(`${TELNYX_API_BASE}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      if (!response.ok) {
        console.error(`[sms:telnyx] send failed [${response.status}]: ${text}`);
        throw new Error(`Telnyx send failed [${response.status}]: ${text}`);
      }

      const flat = flattenTelnyxPayload(JSON.parse(text || "{}") as Record<string, unknown>);
      return {
        provider: "telnyx",
        providerMessageId: flat.messageId ?? `telnyx_${crypto.randomUUID()}`,
        deliveryStatus: flat.status ? mapTelnyxStatus(flat.status) : "queued",
        errorCode: flat.errorCode,
        providerCost: flat.cost,
      };
    },

    handleInboundMessage(payload): InboundMessage | null {
      const flat = flattenTelnyxPayload(payload);
      if (!flat.from || flat.text === null) return null;
      if (flat.eventType && flat.eventType !== "message.received") return null;
      return {
        providerMessageId: flat.messageId ?? `telnyx_in_${crypto.randomUUID()}`,
        from: flat.from,
        to: flat.to ?? "",
        body: flat.text,
        receivedAt: flat.occurredAt ?? new Date().toISOString(),
      };
    },

    handleDeliveryStatus(payload): DeliveryStatusUpdate | null {
      const flat = flattenTelnyxPayload(payload);
      if (!flat.messageId) return null;
      return {
        providerMessageId: flat.messageId,
        deliveryStatus: mapTelnyxStatus(flat.status),
        errorCode: flat.errorCode,
      };
    },

    async verifyWebhook({ headers, rawBody, url }) {
      const publicKey = process.env["TELNYX_PUBLIC_KEY"];
      if (!publicKey) {
        // Fail closed in production: the shared-secret fallback exists only for
        // local development and tests.
        if (isProductionRuntime()) {
          console.error("[sms:telnyx] rejected: TELNYX_PUBLIC_KEY missing in production");
          return {
            verified: false,
            reason: "TELNYX_PUBLIC_KEY is not configured; refusing Telnyx webhook in production.",
          };
        }
        return deps.verifySharedSecret(headers, url);
      }
      return verifyTelnyxSignature({ headers, rawBody, publicKeyBase64: publicKey });
    },


    async checkBalance() {
      return process.env["TELNYX_API_KEY"]
        ? { available: true, detail: "Telnyx API key configured." }
        : { available: false, detail: "Telnyx is not connected." };
    },

    formatProviderError(error) {
      return error instanceof Error ? error.message : String(error);
    },
  };
}

/** Final cost, when Telnyx reports it on `message.finalized`. */
export function telnyxFinalCost(payload: Record<string, unknown>): number | null {
  return flattenTelnyxPayload(payload).cost;
}
