// Client-safe messaging provider configuration.
//
// This file is the single source of truth for which providers BookedSecure
// knows about. It contains NO credentials and NO provider endpoints, so it is
// safe to import from UI code.

export const PROVIDER_IDS = ["simulated", "texto", "telnyx", "sinch", "twilio"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  simulated: "Simulated (recorded, not sent)",
  texto: "Texto (live SMS)",
  telnyx: "Telnyx (live SMS)",
  sinch: "Sinch Engage (not implemented yet)",
  twilio: "Twilio (legacy)",
};

/**
 * What each provider adapter can actually do today. The application must check
 * capabilities instead of assuming a provider supports an operation, so adding
 * Sinch later cannot silently break number management or usage reporting.
 */
export type ProviderCapabilities = {
  /** Outbound sending is implemented and safe to call. */
  sendMessage: boolean;
  /** Inbound webhook payloads can be normalized. */
  inboundWebhooks: boolean;
  /** Delivery-receipt webhook payloads can be normalized. */
  deliveryWebhooks: boolean;
  /** Cryptographic webhook signature verification is implemented. */
  signedWebhooks: boolean;
  /** Buying a new number through the provider API. */
  provisionNumber: boolean;
  /** Releasing a number through the provider API. */
  releaseNumber: boolean;
  /** Binding a number to a BookedSecure tenant at the provider. */
  assignNumberToTenant: boolean;
  /** Reading a number's provider-side status. */
  getNumberStatus: boolean;
  /** Reading a single message's provider-side status. */
  getMessageStatus: boolean;
  /** Reading provider usage/billing data. */
  getUsageData: boolean;
  /** Creating a sub-account for a tenant. */
  provisionAccount: boolean;
  /** Updating a sub-account's settings (caps, state). */
  updateAccount: boolean;
  /** Allocating credits to a tenant account. */
  allocateCredits: boolean;
  /** Recalling credits from a tenant account. */
  recallCredits: boolean;
  /** Reading a single tenant account's usage report. */
  getAccountReport: boolean;
  /** Reading a grouped usage report across tenants. */
  getGroupReport: boolean;
};

const NONE: ProviderCapabilities = {
  sendMessage: false,
  inboundWebhooks: false,
  deliveryWebhooks: false,
  signedWebhooks: false,
  provisionNumber: false,
  releaseNumber: false,
  assignNumberToTenant: false,
  getNumberStatus: false,
  getMessageStatus: false,
  getUsageData: false,
  provisionAccount: false,
  updateAccount: false,
  allocateCredits: false,
  recallCredits: false,
  getAccountReport: false,
  getGroupReport: false,
};

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  simulated: {
    ...NONE,
    sendMessage: true,
    inboundWebhooks: true,
    deliveryWebhooks: true,
    provisionNumber: true,
    releaseNumber: true,
    assignNumberToTenant: true,
    getNumberStatus: true,
    getMessageStatus: true,
  },
  texto: {
    ...NONE,
    sendMessage: true,
    inboundWebhooks: true,
    deliveryWebhooks: true,
    signedWebhooks: true,
    getMessageStatus: true,
    getUsageData: true,
  },
  telnyx: {
    ...NONE,
    sendMessage: true,
    inboundWebhooks: true,
    deliveryWebhooks: true,
    signedWebhooks: true,
    getNumberStatus: true,
  },
  twilio: {
    ...NONE,
    sendMessage: true,
    inboundWebhooks: true,
    deliveryWebhooks: true,
    signedWebhooks: true,
  },
  // TODO(sinch): flip capabilities on one at a time as each operation is
  // implemented against the official Sinch API documentation.
  sinch: { ...NONE },
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Env var names used to force a provider regardless of tenant configuration. */
export const PROVIDER_OVERRIDE_ENV = "SMS_PROVIDER_OVERRIDE";
export const PROVIDER_DEFAULT_ENV = "SMS_PROVIDER";
