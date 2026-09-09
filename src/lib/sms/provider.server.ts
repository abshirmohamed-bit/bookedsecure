// Provider abstraction. The rest of the app never imports Twilio-specific code.
// Every send receives a resolved sender, so credentials are chosen per message
// (platform account, per-business subaccount, or bring-your-own).

import { createTelnyxProvider } from "./telnyx.server";
import { createTextoProvider } from "./texto.server";
import { sinchProvider } from "./sinch.server";

export type CredentialMode = "platform" | "subaccount" | "byo";

export type ResolvedSender = {
  id: string;
  businessId: string;
  phoneNumber: string;
  provider: string;
  credentialMode: CredentialMode;
  subaccountSid: string | null;
  credentialSecretName: string | null;
  messagingProfileId?: string | null;
};

export type SendResult = {
  providerMessageId: string;
  deliveryStatus:
    | "queued"
    | "provider_accepted"
    | "sent"
    | "delivered"
    | "failed"
    | "undelivered"
    | "unknown";
  errorCode?: string | null;
  provider: string;
  providerCost?: number | null;
};

export type InboundMessage = {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
  receivedAt: string;
};

export type DeliveryStatusUpdate = {
  providerMessageId: string;
  deliveryStatus: SendResult["deliveryStatus"];
  errorCode?: string | null;
  /** Raw provider status string, preserved for support and audit only. */
  rawStatus?: string | null;
  /** Provider event id, used as the delivery-event idempotency key. */
  eventId?: string | null;
  /** Provider timestamp for this delivery event. */
  occurredAt?: string | null;
};

export type WebhookVerification = {
  verified: boolean;
  reason?: string;
};

export type SmsProvider = {
  name: string;
  sendMessage(input: { to: string; body: string; sender: ResolvedSender }): Promise<SendResult>;
  handleInboundMessage(payload: Record<string, unknown>): InboundMessage | null;
  handleDeliveryStatus(payload: Record<string, unknown>): DeliveryStatusUpdate | null;
  verifyWebhook(input: {
    url: string;
    params: Record<string, unknown>;
    headers: Headers;
    rawBody: string;
  }): Promise<WebhookVerification>;
  checkBalance(): Promise<{ available: boolean; detail: string }>;
  formatProviderError(error: unknown): string;
};

function str(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

const TWILIO_STATUS_MAP: Record<string, SendResult["deliveryStatus"]> = {
  queued: "queued",
  accepted: "provider_accepted",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
  undelivered: "undelivered",
};

function mapStatus(raw: string | null): SendResult["deliveryStatus"] {
  if (!raw) return "unknown";
  return TWILIO_STATUS_MAP[raw.toLowerCase()] ?? "unknown";
}

/** Shared-secret fallback used when no provider signing token is configured. */
export async function verifySharedSecret(headers: Headers, url: string): Promise<WebhookVerification> {
  const expected = process.env["SMS_WEBHOOK_SECRET"];
  if (!expected) {
    return { verified: false, reason: "No webhook secret configured." };
  }
  const provided =
    headers.get("x-webhook-secret") ?? new URL(url).searchParams.get("t") ?? "";
  if (!provided) return { verified: false, reason: "Missing webhook secret." };

  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  const ok = timingSafeEqual(digest(provided), digest(expected));
  return ok ? { verified: true } : { verified: false, reason: "Invalid webhook secret." };
}

/**
 * Simulated provider: records exactly what would be sent without contacting a
 * carrier. Used until real provider credentials are connected.
 */
export const simulatedProvider: SmsProvider = {
  name: "simulated",
  async sendMessage({ to, body, sender }) {
    // Fault injection for retry testing: this reserved test number always fails,
    // so the bounded retry path can be exercised without a live carrier.
    if (to.replace(/\D/g, "").endsWith("400000009")) {
      throw new Error("simulated_provider_failure: carrier rejected message");
    }
    console.info(`[sms:simulated] ${sender.phoneNumber} -> ${to}: ${body}`);

    return {
      provider: "simulated",
      providerMessageId: `sim_${crypto.randomUUID()}`,
      deliveryStatus: "delivered",
      errorCode: null,
      providerCost: 0,
    };
  },
  handleInboundMessage(payload) {
    const from = str(payload, "From", "from", "sender");
    const body = str(payload, "Body", "body", "message");
    if (!from || body === null) return null;
    return {
      providerMessageId: str(payload, "MessageSid", "message_id") ?? `sim_in_${crypto.randomUUID()}`,
      from,
      to: str(payload, "To", "to") ?? "",
      body,
      receivedAt: new Date().toISOString(),
    };
  },
  handleDeliveryStatus(payload) {
    const providerMessageId = str(payload, "MessageSid", "message_id", "provider_message_id");
    if (!providerMessageId) return null;
    return {
      providerMessageId,
      deliveryStatus: mapStatus(str(payload, "MessageStatus", "status")),
      errorCode: str(payload, "ErrorCode", "error_code"),
    };
  },
  async verifyWebhook({ headers, url }) {
    return verifySharedSecret(headers, url);
  },
  async checkBalance() {
    return { available: true, detail: "Simulated provider — no carrier balance required." };
  },
  formatProviderError(error) {
    return error instanceof Error ? error.message : String(error);
  },
};

/**
 * Twilio through the Lovable connector gateway. Credentials stay server-side and
 * are never sent to the browser. `subaccount`/`byo` senders resolve their own
 * credential; `platform` uses the connected platform account.
 */
export const twilioProvider: SmsProvider = {
  name: "twilio",
  async sendMessage({ to, body, sender }) {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const twilioKey =
      sender.credentialMode === "byo" && sender.credentialSecretName
        ? process.env[sender.credentialSecretName]
        : process.env["TWILIO_API_KEY"];
    if (!lovableKey || !twilioKey) {
      throw new Error("Twilio is not connected yet. Connect Twilio or use the simulated provider.");
    }

    const basePath =
      sender.credentialMode === "subaccount" && sender.subaccountSid
        ? `/2010-04-01/Accounts/${sender.subaccountSid}/Messages.json`
        : "/Messages.json";

    const form = new URLSearchParams({ To: to, From: sender.phoneNumber, Body: body });

    // Delivery receipts come back to our own status webhook, authenticated with
    // the shared secret so callbacks can be verified even without the auth token.
    const publicBase = process.env["PUBLIC_APP_URL"];
    const webhookSecret = process.env["SMS_WEBHOOK_SECRET"];
    if (publicBase && webhookSecret) {
      form.set(
        "StatusCallback",
        `${publicBase.replace(/\/$/, "")}/api/public/sms/status?t=${encodeURIComponent(webhookSecret)}`,
      );
    }

    const response = await fetch(`https://connector-gateway.lovable.dev/twilio${basePath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`[sms:twilio] send failed [${response.status}]: ${text}`);
      throw new Error(`Twilio send failed [${response.status}]: ${text}`);
    }
    const payload = JSON.parse(text) as {
      sid?: string;
      status?: string;
      error_code?: string | null;
      price?: string | null;
    };
    return {
      provider: "twilio",
      providerMessageId: payload.sid ?? `twilio_${crypto.randomUUID()}`,
      deliveryStatus: mapStatus(payload.status ?? null),
      errorCode: payload.error_code ?? null,
      providerCost: payload.price ? Math.abs(Number(payload.price)) : null,
    };
  },
  handleInboundMessage(payload) {
    return simulatedProvider.handleInboundMessage(payload);
  },
  handleDeliveryStatus(payload) {
    return simulatedProvider.handleDeliveryStatus(payload);
  },
  /**
   * Twilio signs each webhook: HMAC-SHA1 over the full URL plus the POST
   * parameters sorted by key, base64-encoded, keyed by the account auth token.
   * When no auth token is available (gateway-held credentials) we fall back to
   * the shared webhook secret so the endpoint is never unauthenticated.
   */
  async verifyWebhook({ url, params, headers }) {
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    const signature = headers.get("x-twilio-signature");
    if (!authToken || !signature) {
      return verifySharedSecret(headers, url);
    }

    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const base = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + String(params[key] ?? ""), url);
    const expected = createHmac("sha1", authToken).update(base, "utf8").digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return ok ? { verified: true } : { verified: false, reason: "Invalid Twilio signature." };
  },
  async checkBalance() {
    const twilioKey = process.env["TWILIO_API_KEY"];
    return twilioKey
      ? { available: true, detail: "Twilio connection linked." }
      : { available: false, detail: "Twilio is not connected." };
  },
  formatProviderError(error) {
    return error instanceof Error ? error.message : String(error);
  },
};

/** Telnyx adapter, sharing the shared-secret fallback with the other providers. */
export const telnyxProvider: SmsProvider = createTelnyxProvider({ verifySharedSecret });

/** Texto adapter (api.texto.com.au), sharing the shared-secret dev fallback. */
export const textoProvider: SmsProvider = createTextoProvider({ verifySharedSecret });

/**
 * Legacy adapter lookup. Provider *selection* (env overrides, defaults) lives in
 * registry.server.ts; this function only maps an id to an implementation.
 */
export function getLegacyProvider(id: string): SmsProvider {
  if (id === "twilio") return process.env["TWILIO_API_KEY"] ? twilioProvider : simulatedProvider;
  if (id === "telnyx") return telnyxProvider;
  if (id === "texto") return textoProvider;
  if (id === "sinch") return sinchProvider;
  return simulatedProvider;
}

/**
 * Provider used for a given sender/business. Kept for the existing engine call
 * sites; it now routes through the central selection rules so a feature-flag
 * switch needs no business-logic change.
 */
export function getProvider(name: string | null | undefined): SmsProvider {
  const override = process.env["SMS_PROVIDER_OVERRIDE"];
  const fallback = process.env["SMS_PROVIDER"];
  const id = KNOWN_PROVIDER_IDS.includes(override ?? "")
    ? override!
    : KNOWN_PROVIDER_IDS.includes(name ?? "")
      ? name!
      : KNOWN_PROVIDER_IDS.includes(fallback ?? "")
        ? fallback!
        : "simulated";
  return getLegacyProvider(id);
}

const KNOWN_PROVIDER_IDS: string[] = ["simulated", "texto", "telnyx", "sinch", "twilio"];
