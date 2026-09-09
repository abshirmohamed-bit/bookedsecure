// Provider registry: the one place that decides which adapter handles a message.
//
// Selection order (first match wins):
//   1. SMS_PROVIDER_OVERRIDE   — emergency/feature-flag override for all tenants
//   2. the value passed in     — normally sms_senders.provider, else the business default
//   3. SMS_PROVIDER            — deployment default
//   4. "simulated"             — always safe

import {
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_ENV,
  PROVIDER_OVERRIDE_ENV,
  isProviderId,
  type ProviderId,
} from "./config";
import { fromLegacySmsProvider, type MessagingProvider, type NumberRecord } from "./contract.server";
import {
  getLegacyProvider,
  simulatedProvider,
  telnyxProvider,
  textoProvider,
  twilioProvider,
} from "./provider.server";
import { sinchProvider } from "./sinch.server";

export function resolveProviderId(requested?: string | null): ProviderId {
  const override = process.env[PROVIDER_OVERRIDE_ENV];
  if (isProviderId(override)) return override;
  if (isProviderId(requested)) return requested;
  const fallback = process.env[PROVIDER_DEFAULT_ENV];
  if (isProviderId(fallback)) return fallback;
  return "simulated";
}

/** In-memory number book so the simulated provider can exercise number flows. */
const simulatedNumbers = new Map<string, NumberRecord>();

function simulatedOverrides(): Partial<MessagingProvider> {
  const record = (phoneNumber: string, tenantId: string | null): NumberRecord => ({
    phoneNumber,
    providerId: "simulated",
    status: "active",
    assignedTenantId: tenantId,
  });
  return {
    async provisionNumber({ countryCode }) {
      const phoneNumber = `${countryCode}4${String(Date.now()).slice(-8)}`;
      const created = record(phoneNumber, null);
      simulatedNumbers.set(phoneNumber, created);
      return created;
    },
    async releaseNumber({ phoneNumber }) {
      simulatedNumbers.delete(phoneNumber);
    },
    async assignNumberToTenant({ phoneNumber, tenantId }) {
      const assigned = record(phoneNumber, tenantId);
      simulatedNumbers.set(phoneNumber, assigned);
      return assigned;
    },
    async getNumberStatus({ phoneNumber }) {
      return simulatedNumbers.get(phoneNumber) ?? record(phoneNumber, null);
    },
    async getMessageStatus() {
      return "delivered";
    },
  };
}

function textoOverrides(): Partial<MessagingProvider> {
  return {
    // Read-only lookup against the documented Texto message resource.
    async getMessageStatus({ providerMessageId }) {
      const apiKey = process.env["TEXTO_API_KEY"];
      if (!apiKey) throw new Error("Texto is not connected.");
      const response = await fetch(`https://api.texto.com.au/message/${providerMessageId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error(`Texto message lookup failed [${response.status}]`);
      const body = (await response.json()) as {
        message?: { status?: string };
        delivery_receipt?: { status?: string } | null;
      };
      return body.delivery_receipt?.status ?? body.message?.status ?? "unknown";
    },
  };
}

function telnyxOverrides(): Partial<MessagingProvider> {
  return {
    // Read-only lookup against the documented Telnyx v2 phone-numbers resource.
    async getNumberStatus({ phoneNumber }) {
      const apiKey = process.env["TELNYX_API_KEY"];
      if (!apiKey) throw new Error("Telnyx is not connected.");
      const url = new URL("https://api.telnyx.com/v2/phone_numbers");
      url.searchParams.set("filter[phone_number]", phoneNumber);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`Telnyx number lookup failed [${response.status}]`);
      const body = (await response.json()) as {
        data?: Array<{ phone_number?: string; status?: string; messaging_profile_id?: string }>;
      };
      const first = body.data?.[0];
      return {
        phoneNumber: first?.phone_number ?? phoneNumber,
        providerId: "telnyx",
        status: first?.status ?? "unknown",
        assignedTenantId: null,
      };
    },
  };
}

export function getMessagingProvider(requested?: string | null): MessagingProvider {
  const id = resolveProviderId(requested);

  switch (id) {
    case "texto":
      return fromLegacySmsProvider(textoProvider, {
        id,
        capabilities: PROVIDER_CAPABILITIES.texto,
        overrides: textoOverrides(),
      });
    case "telnyx":
      return fromLegacySmsProvider(telnyxProvider, {
        id,
        capabilities: PROVIDER_CAPABILITIES.telnyx,
        overrides: telnyxOverrides(),
      });
    case "twilio":
      return fromLegacySmsProvider(getLegacyProvider("twilio"), {
        id: "twilio",
        capabilities: PROVIDER_CAPABILITIES.twilio,
      });
    case "sinch":
      // TODO(sinch): capabilities stay all-false until the real adapter lands,
      // so every operation throws ProviderOperationNotSupportedError.
      return fromLegacySmsProvider(sinchProvider, {
        id,
        capabilities: PROVIDER_CAPABILITIES.sinch,
      });
    default:
      return fromLegacySmsProvider(simulatedProvider, {
        id: "simulated",
        capabilities: PROVIDER_CAPABILITIES.simulated,
        overrides: simulatedOverrides(),
      });
  }
}
