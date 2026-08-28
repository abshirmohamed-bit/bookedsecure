// Sinch Engage adapter — PLACEHOLDER ONLY.
//
// Nothing here talks to Sinch. No endpoint URL, credential name, auth scheme or
// signature algorithm has been invented. Every operation fails closed until the
// official Sinch API + webhook documentation is supplied and implemented.
//
// TODO(sinch): required before this adapter can be enabled
//   1. Base API URL + API version.
//   2. Authentication mechanism (token type, header name, scoping).
//   3. Outbound send request/response shape and message-id field.
//   4. Inbound webhook payload shape (message text, from, to, event id).
//   5. Delivery-receipt payload shape + status vocabulary -> InternalDeliveryStatus map.
//   6. Webhook signature scheme (algorithm, signed material, header names, tolerance).
//   7. Number provisioning / release / assignment endpoints.
//   8. Usage or billing reporting endpoint, if any.
//   9. Australian two-way number requirements and sender registration rules.

import type { SmsProvider } from "./provider.server";

/** Env var names reserved for Sinch. Intentionally unset until documented. */
export const SINCH_ENV_VARS = [
  "SINCH_API_TOKEN", // TODO(sinch): confirm the real credential name/format
  "SINCH_PROJECT_ID", // TODO(sinch): confirm tenant/project identifier name
  "SINCH_WEBHOOK_SECRET", // TODO(sinch): confirm signature verification material
] as const;

const NOT_IMPLEMENTED =
  "Sinch Engage is not implemented yet. Official Sinch API and webhook documentation is required before this provider can send or receive messages.";

export function sinchConfigurationStatus(): {
  configured: boolean;
  implemented: boolean;
  missing: string[];
  detail: string;
} {
  const missing = SINCH_ENV_VARS.filter((name) => !process.env[name]);
  return {
    configured: missing.length === 0,
    implemented: false,
    missing: [...missing],
    detail: NOT_IMPLEMENTED,
  };
}

export const sinchProvider: SmsProvider = {
  name: "sinch",

  async sendMessage() {
    // TODO(sinch): implement POST to the documented Sinch send endpoint.
    throw new Error(NOT_IMPLEMENTED);
  },

  handleInboundMessage() {
    // TODO(sinch): map the documented inbound payload to InboundMessage.
    return null;
  },

  handleDeliveryStatus() {
    // TODO(sinch): map the documented delivery-receipt payload + status vocabulary.
    return null;
  },

  async verifyWebhook() {
    // Fail closed in every environment: no signature scheme has been documented,
    // so no Sinch webhook can be trusted yet.
    return {
      verified: false,
      reason: "Sinch webhook signature verification is not implemented yet.",
    };
  },

  async checkBalance() {
    return { available: false, detail: NOT_IMPLEMENTED };
  },

  formatProviderError(error) {
    return error instanceof Error ? error.message : String(error);
  },
};
