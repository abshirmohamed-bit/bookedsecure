// Texto (api.texto.com.au) adapter. Lives behind the shared SmsProvider
// interface, so nothing outside src/lib/sms knows Texto exists.
//
// Transition phase: the adapter, webhooks and balance check are complete, but no
// tenant is switched to Texto until its sender row names this provider (or the
// deployment default/override is flipped). Nothing here changes tenant data.

import type {
  DeliveryStatusUpdate,
  InboundMessage,
  SendResult,
  SmsProvider,
  WebhookVerification,
} from "./provider.server";
import { isProductionRuntime, normaliseE164 } from "./telnyx.server";

export const TEXTO_API_BASE = "https://api.texto.com.au";

/** Texto reports queued | sent | delivered | failed. */
const TEXTO_STATUS_MAP: Record<string, SendResult["deliveryStatus"]> = {
  queued: "queued",
  accepted: "provider_accepted",
  pending: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
  undelivered: "undelivered",
  expired: "undelivered",
  rejected: "failed",
};

export function mapTextoStatus(raw: string | null | undefined): SendResult["deliveryStatus"] {
  if (!raw) return "unknown";
  return TEXTO_STATUS_MAP[raw.toLowerCase().trim()] ?? "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export type FlatTextoEvent = {
  /** "message.dlr" | "message.inbound" when the payload declares one. */
  eventType: string | null;
  messageId: string | null;
  from: string | null;
  to: string | null;
  body: string | null;
  status: string | null;
  occurredAt: string | null;
  isOptout: boolean;
};

/**
 * Normalises both Texto webhook shapes:
 *   delivery: { message: {...}, delivery_receipt: {...} }
 *   inbound:  { event, message_id, from, to, body, received_at, is_optout }
 */
export function flattenTextoPayload(payload: Record<string, unknown>): FlatTextoEvent {
  const message = asRecord(payload["message"]);
  const receipt = asRecord(payload["delivery_receipt"]);
  const declared = text(payload["event"]);
  const inbound = declared === "message.inbound" || text(payload["message_id"]) !== null;

  return {
    eventType: declared ?? (Object.keys(message).length > 0 ? "message.dlr" : null),
    messageId: text(payload["message_id"]) ?? text(message["id"]),
    from: text(payload["from"]),
    to: text(payload["to"]) ?? text(message["recipient"]),
    body: text(payload["body"]) ?? text(message["body"]),
    status: inbound ? null : (text(receipt["status"]) ?? text(message["status"])),
    occurredAt:
      text(payload["received_at"]) ??
      text(receipt["received_at"]) ??
      text(message["sent_at"]),
    isOptout: payload["is_optout"] === true,
  };
}

/** Request body sent to POST /send. */
export function buildTextoSendPayload(input: {
  to: string;
  from: string;
  body: string;
  campaign?: string | null;
}): Record<string, string> {
  const payload: Record<string, string> = {
    to: normaliseE164(input.to),
    message: input.body,
    sender: normaliseE164(input.from),
  };
  if (input.campaign) payload["campaign"] = input.campaign.slice(0, 200);
  return payload;
}

/**
 * Texto signs webhooks with HMAC-SHA256 over the raw body, sending
 * `sha256=<hex>` in `x-texto-signature`. Delivery receipts and inbound messages
 * have separate signing secrets.
 */
export async function verifyTextoSignature(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
}): Promise<WebhookVerification> {
  const header = input.headers.get("x-texto-signature");
  if (!header) return { verified: false, reason: "Missing Texto signature header." };
  const provided = header.replace(/^sha256=/, "").trim();

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha256", input.secret).update(input.rawBody, "utf8").digest("hex");
  if (provided.length !== expected.length) {
    return { verified: false, reason: "Invalid Texto signature." };
  }
  const ok = timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  return ok ? { verified: true } : { verified: false, reason: "Invalid Texto signature." };
}

function apiKeyFor(sender: { credentialMode: string; credentialSecretName: string | null }) {
  return sender.credentialMode === "byo" && sender.credentialSecretName
    ? process.env[sender.credentialSecretName]
    : process.env["TEXTO_API_KEY"];
}

export function createTextoProvider(deps: {
  verifySharedSecret: (headers: Headers, url: string) => Promise<WebhookVerification>;
}): SmsProvider {
  return {
    name: "texto",

    async sendMessage({ to, body, sender }) {
      const apiKey = apiKeyFor(sender);
      if (!apiKey) {
        throw new Error(
          "Texto is not connected yet. Add a Texto API key or use the simulated provider.",
        );
      }

      const response = await fetch(`${TEXTO_API_BASE}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTextoSendPayload({ to, from: sender.phoneNumber, body })),
      });

      const raw = await response.text();
      if (!response.ok) {
        console.error(`[sms:texto] send failed [${response.status}]: ${raw}`);
        throw new Error(`Texto send failed [${response.status}]: ${raw}`);
      }

      const payload = JSON.parse(raw || "{}") as {
        message_id?: string;
        credits_used?: number;
        status?: string;
      };
      return {
        provider: "texto",
        providerMessageId: payload.message_id ?? `texto_${crypto.randomUUID()}`,
        // /send returns no carrier status; the DLR webhook supplies it.
        deliveryStatus: payload.status ? mapTextoStatus(payload.status) : "provider_accepted",
        errorCode: null,
        // Texto bills in credits, not currency, so cost stays null and the
        // credit count is left to reporting.
        providerCost: null,
      };
    },

    handleInboundMessage(payload): InboundMessage | null {
      const flat = flattenTextoPayload(payload);
      if (flat.eventType && flat.eventType !== "message.inbound") return null;
      if (!flat.from || flat.body === null) return null;
      return {
        providerMessageId: flat.messageId ?? `texto_in_${crypto.randomUUID()}`,
        from: flat.from,
        to: flat.to ?? "",
        body: flat.body,
        receivedAt: flat.occurredAt ?? new Date().toISOString(),
      };
    },

    handleDeliveryStatus(payload): DeliveryStatusUpdate | null {
      const flat = flattenTextoPayload(payload);
      if (!flat.messageId || flat.eventType === "message.inbound") return null;
      return {
        providerMessageId: flat.messageId,
        deliveryStatus: mapTextoStatus(flat.status),
        errorCode: null,
        rawStatus: flat.status,
        // Texto has no body-level event id; the route hashes the payload and
        // dedupes on the X-Texto-Delivery header.
        eventId: null,
        occurredAt: flat.occurredAt,
      };
    },

    async verifyWebhook({ headers, rawBody, url }) {
      const inbound = headers.get("x-texto-event") === "message.inbound";
      const secret = inbound
        ? (process.env["TEXTO_INBOUND_WEBHOOK_SECRET"] ?? process.env["TEXTO_WEBHOOK_SECRET"])
        : process.env["TEXTO_WEBHOOK_SECRET"];
      if (!secret) {
        if (isProductionRuntime()) {
          console.error("[sms:texto] rejected: Texto webhook secret missing in production");
          return {
            verified: false,
            reason: "Texto webhook secret is not configured; refusing webhook in production.",
          };
        }
        return deps.verifySharedSecret(headers, url);
      }
      return verifyTextoSignature({ headers, rawBody, secret });
    },

    async checkBalance() {
      const apiKey = process.env["TEXTO_API_KEY"];
      if (!apiKey) return { available: false, detail: "Texto is not connected." };
      try {
        const response = await fetch(`${TEXTO_API_BASE}/balance`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const raw = await response.text();
        if (!response.ok) {
          return { available: false, detail: `Texto balance check failed [${response.status}]: ${raw}` };
        }
        const credits = (JSON.parse(raw || "{}") as { credits?: number }).credits ?? 0;
        return {
          available: credits > 0,
          detail:
            credits > 0
              ? `Texto connected — ${credits} credits remaining.`
              : "Texto connected but the credit balance is empty.",
        };
      } catch (error) {
        return {
          available: false,
          detail: `Texto balance check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    formatProviderError(error) {
      return error instanceof Error ? error.message : String(error);
    },
  };
}
