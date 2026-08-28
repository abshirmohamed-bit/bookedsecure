// The stable internal messaging contract.
//
// BookedSecure business logic (leads, conversations, follow-ups, consent,
// usage, analytics) talks to this interface only. Provider adapters implement
// it; unsupported operations throw ProviderOperationNotSupportedError instead
// of guessing.

import type { ProviderCapabilities, ProviderId } from "./config";
import {
  eventTypeForDeliveryStatus,
  type InternalDeliveryStatus,
  type NormalizedMessagingEvent,
} from "./events";
import type { ResolvedSender, SmsProvider } from "./provider.server";

export class ProviderOperationNotSupportedError extends Error {
  constructor(providerId: string, operation: string) {
    super(`Provider "${providerId}" does not implement ${operation} yet.`);
    this.name = "ProviderOperationNotSupportedError";
  }
}

export type SendMessageInput = {
  to: string;
  body: string;
  sender: ResolvedSender;
};

export type SendMessageResult = {
  providerMessageId: string;
  deliveryStatus: InternalDeliveryStatus;
  providerId: string;
  rawErrorCode: string | null;
  cost: number | null;
};

export type WebhookValidation = { verified: boolean; reason?: string };

export type NumberRecord = {
  phoneNumber: string;
  providerId: string;
  /** Provider-side lifecycle status, e.g. "active". Never a business status. */
  status: string;
  assignedTenantId: string | null;
};

export type UsageWindow = { from: string; to: string };

export type ProviderUsage = {
  providerId: string;
  window: UsageWindow;
  messagesOut: number;
  segmentsOut: number;
  cost: number;
};

export type MessagingProvider = {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /** Normalizes an inbound-message webhook payload. */
  receiveInboundMessage(payload: Record<string, unknown>): NormalizedMessagingEvent | null;

  /** Normalizes a delivery-receipt / failure webhook payload. */
  handleDeliveryUpdate(payload: Record<string, unknown>): NormalizedMessagingEvent | null;

  /** Any webhook payload -> one normalized internal event (or null when ignorable). */
  normalizeWebhookEvent(payload: Record<string, unknown>): NormalizedMessagingEvent | null;

  validateWebhook(input: {
    url: string;
    params: Record<string, unknown>;
    headers: Headers;
    rawBody: string;
  }): Promise<WebhookValidation>;

  getMessageStatus(providerMessageId: string): Promise<InternalDeliveryStatus>;

  provisionNumber(input: { countryCode: string; areaCode?: string }): Promise<NumberRecord>;
  releaseNumber(input: { phoneNumber: string }): Promise<void>;
  assignNumberToTenant(input: { phoneNumber: string; tenantId: string }): Promise<NumberRecord>;
  getNumberStatus(input: { phoneNumber: string }): Promise<NumberRecord>;

  getUsageData(window: UsageWindow): Promise<ProviderUsage>;

  /** Connectivity / credential health, safe to show to BookedSecure staff. */
  healthCheck(): Promise<{ available: boolean; detail: string }>;

  formatProviderError(error: unknown): string;
};

function unsupported(id: ProviderId, operation: string): never {
  throw new ProviderOperationNotSupportedError(id, operation);
}

/**
 * Wraps a legacy `SmsProvider` (simulated / twilio / telnyx) in the new
 * contract. This is how the existing pilot keeps working unchanged while the
 * rest of the app migrates to the provider-agnostic interface.
 */
export function fromLegacySmsProvider(
  legacy: SmsProvider,
  options: {
    id: ProviderId;
    capabilities: ProviderCapabilities;
    overrides?: Partial<MessagingProvider>;
  },
): MessagingProvider {
  const { id, capabilities } = options;

  const diagnostics = (
    rawStatus: string | null,
    rawErrorCode: string | null,
    cost: number | null,
  ) => ({ providerId: id, rawStatus, rawErrorCode, cost });

  const base: MessagingProvider = {
    id,
    capabilities,

    async sendMessage({ to, body, sender }) {
      if (!capabilities.sendMessage) unsupported(id, "sendMessage");
      const result = await legacy.sendMessage({ to, body, sender });
      return {
        providerMessageId: result.providerMessageId,
        deliveryStatus: result.deliveryStatus,
        providerId: result.provider,
        rawErrorCode: result.errorCode ?? null,
        cost: result.providerCost ?? null,
      };
    },

    receiveInboundMessage(payload) {
      if (!capabilities.inboundWebhooks) return null;
      const inbound = legacy.handleInboundMessage(payload);
      if (!inbound) return null;
      return {
        type: "message.received",
        eventId: null,
        occurredAt: inbound.receivedAt,
        tenantNumber: inbound.to || null,
        contactNumber: inbound.from,
        providerMessageId: inbound.providerMessageId,
        text: inbound.body,
        deliveryStatus: "delivered",
        provider: diagnostics("received", null, null),
      };
    },

    handleDeliveryUpdate(payload) {
      if (!capabilities.deliveryWebhooks) return null;
      const update = legacy.handleDeliveryStatus(payload);
      if (!update) return null;
      const type = eventTypeForDeliveryStatus(update.deliveryStatus) ?? "message.sent";
      return {
        type,
        eventId: null,
        occurredAt: new Date().toISOString(),
        tenantNumber: null,
        contactNumber: null,
        providerMessageId: update.providerMessageId,
        text: null,
        deliveryStatus: update.deliveryStatus,
        provider: diagnostics(update.deliveryStatus, update.errorCode ?? null, null),
      };
    },

    normalizeWebhookEvent(payload) {
      return base.receiveInboundMessage(payload) ?? base.handleDeliveryUpdate(payload);
    },

    async validateWebhook(input) {
      return await legacy.verifyWebhook(input);
    },

    async getMessageStatus() {
      if (!capabilities.getMessageStatus) unsupported(id, "getMessageStatus");
      return "unknown";
    },

    async provisionNumber() {
      return unsupported(id, "provisionNumber");
    },
    async releaseNumber() {
      return unsupported(id, "releaseNumber");
    },
    async assignNumberToTenant() {
      return unsupported(id, "assignNumberToTenant");
    },
    async getNumberStatus() {
      return unsupported(id, "getNumberStatus");
    },
    async getUsageData() {
      return unsupported(id, "getUsageData");
    },

    async healthCheck() {
      return await legacy.checkBalance();
    },

    formatProviderError(error) {
      return legacy.formatProviderError(error);
    },
  };

  return { ...base, ...(options.overrides ?? {}) };
}
