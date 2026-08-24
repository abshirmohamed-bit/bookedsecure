// Provider abstraction. The rest of the app never imports Twilio-specific code.

export type SendResult = {
  providerMessageId: string;
  deliveryStatus: "queued" | "sent" | "delivered" | "failed" | "undelivered" | "unknown";
  errorCode?: string | null;
  provider: string;
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
};

export type SmsProvider = {
  name: string;
  sendMessage(input: { to: string; from?: string | null; body: string }): Promise<SendResult>;
  handleInboundMessage(payload: Record<string, unknown>): InboundMessage | null;
  handleDeliveryStatus(payload: Record<string, unknown>): DeliveryStatusUpdate | null;
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
  accepted: "queued",
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

/**
 * Simulated provider: records exactly what would be sent without contacting a
 * carrier. Used until real provider credentials are connected.
 */
export const simulatedProvider: SmsProvider = {
  name: "simulated",
  async sendMessage({ to, body }) {
    console.info(`[sms:simulated] -> ${to}: ${body}`);
    return {
      provider: "simulated",
      providerMessageId: `sim_${crypto.randomUUID()}`,
      deliveryStatus: "delivered",
      errorCode: null,
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
  async checkBalance() {
    return { available: true, detail: "Simulated provider — no carrier balance required." };
  },
  formatProviderError(error) {
    return error instanceof Error ? error.message : String(error);
  },
};

/**
 * Twilio through the Lovable connector gateway. Active only once the Twilio
 * connection is linked; credentials stay server-side.
 */
export const twilioProvider: SmsProvider = {
  name: "twilio",
  async sendMessage({ to, from, body }) {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const twilioKey = process.env["TWILIO_API_KEY"];
    if (!lovableKey || !twilioKey) {
      throw new Error("Twilio is not connected yet. Connect Twilio or use the simulated provider.");
    }
    const response = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from ?? "", Body: body }),
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`[sms:twilio] send failed [${response.status}]: ${text}`);
      throw new Error(`Twilio send failed [${response.status}]: ${text}`);
    }
    const payload = JSON.parse(text) as { sid?: string; status?: string; error_code?: string | null };
    return {
      provider: "twilio",
      providerMessageId: payload.sid ?? `twilio_${crypto.randomUUID()}`,
      deliveryStatus: mapStatus(payload.status ?? null),
      errorCode: payload.error_code ?? null,
    };
  },
  handleInboundMessage(payload) {
    return simulatedProvider.handleInboundMessage(payload);
  },
  handleDeliveryStatus(payload) {
    return simulatedProvider.handleDeliveryStatus(payload);
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

export function getProvider(name: string | null | undefined): SmsProvider {
  if (name === "twilio" && process.env["TWILIO_API_KEY"]) return twilioProvider;
  return simulatedProvider;
}
