// Read-only Telnyx activation readiness check.
//
// Strictly diagnostic: it performs GET requests only — it never sends a
// message, never provisions or releases a number, and never touches tenant,
// billing or sender activation state. Secret VALUES are never returned; only
// "present / missing" booleans reach the caller.

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

/** The Australian number approved in the Telnyx portal for the pilot. */
export const TELNYX_PILOT_NUMBER = "+61468045220";

export type ReadinessCheckId =
  | "api_key_present"
  | "public_key_present"
  | "number_active"
  | "profile_attached"
  | "messaging_enabled"
  | "webhook_url_matches"
  | "api_v2_confirmed";

export type ReadinessCheck = {
  id: ReadinessCheckId;
  label: string;
  status: "pass" | "fail" | "unknown";
  detail: string;
};

export type TelnyxReadinessReport = {
  phoneNumber: string;
  expectedWebhookUrl: string | null;
  expectedProfileId: string | null;
  senderRow: {
    exists: boolean;
    active: boolean;
    assignedBusinessId: string | null;
    messagingProfileId: string | null;
  };
  checks: ReadinessCheck[];
  overall: "ready" | "not_ready";
};

export type NumberFacts = {
  status: string | null;
  numberId: string | null;
};

export type MessagingFacts = {
  messagingProfileId: string | null;
  messagingEnabled: boolean | null;
};

export type ProfileFacts = {
  webhookUrl: string | null;
  webhookApiVersion: string | null;
};

function check(
  id: ReadinessCheckId,
  label: string,
  status: ReadinessCheck["status"],
  detail: string,
): ReadinessCheck {
  return { id, label, status, detail };
}

function sameUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();
}

/**
 * Pure evaluation of the readiness facts. Kept free of network and secret
 * access so it is fully unit-testable.
 */
export function evaluateTelnyxReadiness(input: {
  phoneNumber: string;
  apiKeyPresent: boolean;
  publicKeyPresent: boolean;
  expectedWebhookUrl: string | null;
  expectedProfileId: string | null;
  senderRow: TelnyxReadinessReport["senderRow"];
  number: NumberFacts | null;
  messaging: MessagingFacts | null;
  profile: ProfileFacts | null;
  lookupError?: string | null;
}): TelnyxReadinessReport {
  const checks: ReadinessCheck[] = [];

  checks.push(
    input.apiKeyPresent
      ? check("api_key_present", "Telnyx API key present", "pass", "A server-side Telnyx API key is configured.")
      : check(
          "api_key_present",
          "Telnyx API key present",
          "fail",
          "TELNYX_API_KEY is not configured on the server. Add it before activation.",
        ),
  );

  checks.push(
    input.publicKeyPresent
      ? check(
          "public_key_present",
          "Telnyx public key present",
          "pass",
          "Webhook signature verification key is configured.",
        )
      : check(
          "public_key_present",
          "Telnyx public key present",
          "fail",
          "TELNYX_PUBLIC_KEY is not configured on the server. Webhooks are refused in production without it.",
        ),
  );

  const unknownDetail = input.apiKeyPresent
    ? (input.lookupError ?? "Telnyx did not return this information.")
    : "Cannot be checked until a Telnyx API key is configured.";

  const numberStatus = input.number?.status ?? null;
  checks.push(
    numberStatus === null
      ? check("number_active", "Number active at Telnyx", "unknown", unknownDetail)
      : numberStatus.toLowerCase() === "active"
        ? check("number_active", "Number active at Telnyx", "pass", `${input.phoneNumber} is active.`)
        : check(
            "number_active",
            "Number active at Telnyx",
            "fail",
            `Telnyx reports status "${numberStatus}".`,
          ),
  );

  const liveProfileId = input.messaging?.messagingProfileId ?? null;
  checks.push(
    liveProfileId === null
      ? check("profile_attached", "Attached to the expected Messaging Profile", "unknown", unknownDetail)
      : input.expectedProfileId && liveProfileId !== input.expectedProfileId
        ? check(
            "profile_attached",
            "Attached to the expected Messaging Profile",
            "fail",
            "The number is attached to a different Messaging Profile than the one recorded for this sender.",
          )
        : check(
            "profile_attached",
            "Attached to the expected Messaging Profile",
            "pass",
            "The number is attached to a Messaging Profile.",
          ),
  );

  const messagingEnabled = input.messaging?.messagingEnabled ?? null;
  checks.push(
    messagingEnabled === null
      ? check("messaging_enabled", "Messaging enabled on the number", "unknown", unknownDetail)
      : messagingEnabled
        ? check("messaging_enabled", "Messaging enabled on the number", "pass", "SMS is enabled.")
        : check(
            "messaging_enabled",
            "Messaging enabled on the number",
            "fail",
            "SMS is not enabled on this number at Telnyx.",
          ),
  );

  const liveWebhook = input.profile?.webhookUrl ?? null;
  checks.push(
    liveWebhook === null
      ? check("webhook_url_matches", "Webhook URL matches this app", "unknown", unknownDetail)
      : sameUrl(liveWebhook, input.expectedWebhookUrl)
        ? check("webhook_url_matches", "Webhook URL matches this app", "pass", "Telnyx posts to this app's Telnyx webhook route.")
        : check(
            "webhook_url_matches",
            "Webhook URL matches this app",
            "fail",
            "The Messaging Profile webhook URL does not match this app's Telnyx webhook route.",
          ),
  );

  const apiVersion = input.profile?.webhookApiVersion ?? null;
  checks.push(
    apiVersion === null
      ? check("api_v2_confirmed", "Webhook API v2 configured", "unknown", unknownDetail)
      : ["2", "v2", "2.0"].includes(apiVersion.toLowerCase())
        ? check("api_v2_confirmed", "Webhook API v2 configured", "pass", "Profile uses webhook API v2.")
        : check(
            "api_v2_confirmed",
            "Webhook API v2 configured",
            "fail",
            `Profile uses webhook API version "${apiVersion}"; v2 is required.`,
          ),
  );

  return {
    phoneNumber: input.phoneNumber,
    expectedWebhookUrl: input.expectedWebhookUrl,
    expectedProfileId: input.expectedProfileId,
    senderRow: input.senderRow,
    checks,
    overall: checks.every((item) => item.status === "pass") ? "ready" : "not_ready",
  };
}

/** GET helper. Never throws upward with credential material in the message. */
async function telnyxGet(
  path: string,
  apiKey: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`${TELNYX_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return { ok: false, reason: `Telnyx lookup failed (HTTP ${response.status}).` };
    return { ok: true, body: (await response.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "Telnyx could not be reached." };
  }
}

function first(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0]) {
    return value[0] as Record<string, unknown>;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Collects the live Telnyx facts with GET requests only. `fetchImpl` exists so
 * tests can assert that no outbound message request is ever made.
 */
export async function collectTelnyxFacts(input: {
  phoneNumber: string;
  apiKey: string;
}): Promise<{
  number: NumberFacts | null;
  messaging: MessagingFacts | null;
  profile: ProfileFacts | null;
  error: string | null;
}> {
  const numberResult = await telnyxGet(
    `/phone_numbers?filter[phone_number]=${encodeURIComponent(input.phoneNumber)}`,
    input.apiKey,
  );
  if (!numberResult.ok) {
    return { number: null, messaging: null, profile: null, error: numberResult.reason };
  }
  const numberRow = first(numberResult.body["data"]);
  const numberFacts: NumberFacts = {
    status: text(numberRow?.["status"]),
    numberId: text(numberRow?.["id"]),
  };

  const messagingResult = numberFacts.numberId
    ? await telnyxGet(`/phone_numbers/${numberFacts.numberId}/messaging`, input.apiKey)
    : { ok: false as const, reason: "Telnyx did not return a number id." };
  if (!messagingResult.ok) {
    return { number: numberFacts, messaging: null, profile: null, error: messagingResult.reason };
  }
  const messagingRow = first(messagingResult.body["data"]);
  const profileId = text(messagingRow?.["messaging_profile_id"]);
  const messagingFacts: MessagingFacts = {
    messagingProfileId: profileId,
    messagingEnabled: profileId !== null,
  };

  if (!profileId) {
    return {
      number: numberFacts,
      messaging: messagingFacts,
      profile: null,
      error: "The number is not attached to a Messaging Profile.",
    };
  }

  const profileResult = await telnyxGet(`/messaging_profiles/${profileId}`, input.apiKey);
  if (!profileResult.ok) {
    return { number: numberFacts, messaging: messagingFacts, profile: null, error: profileResult.reason };
  }
  const profileRow = first(profileResult.body["data"]);
  return {
    number: numberFacts,
    messaging: messagingFacts,
    profile: {
      webhookUrl: text(profileRow?.["webhook_url"]),
      webhookApiVersion: text(profileRow?.["webhook_api_version"]),
    },
    error: null,
  };
}

export function expectedTelnyxWebhookUrl(publicAppUrl: string | null | undefined): string | null {
  if (!publicAppUrl) return null;
  return `${publicAppUrl.replace(/\/$/, "")}/api/public/sms/telnyx`;
}

/** Full read-only readiness pass. Requires the caller to be already authorized. */
export async function runTelnyxReadinessCheck(): Promise<TelnyxReadinessReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const apiKey = process.env["TELNYX_API_KEY"] ?? "";
  const publicKey = process.env["TELNYX_PUBLIC_KEY"] ?? "";
  const expectedWebhookUrl = expectedTelnyxWebhookUrl(process.env["PUBLIC_APP_URL"] ?? null);

  const { data: row } = await supabaseAdmin
    .from("sms_senders")
    .select("id, business_id, active, messaging_profile_id")
    .eq("phone_number", TELNYX_PILOT_NUMBER)
    .maybeSingle();

  const senderRow: TelnyxReadinessReport["senderRow"] = {
    exists: Boolean(row),
    active: row?.active ?? false,
    assignedBusinessId: row?.business_id ?? null,
    messagingProfileId: row?.messaging_profile_id ?? null,
  };

  const facts = apiKey
    ? await collectTelnyxFacts({ phoneNumber: TELNYX_PILOT_NUMBER, apiKey })
    : { number: null, messaging: null, profile: null, error: null };

  return evaluateTelnyxReadiness({
    phoneNumber: TELNYX_PILOT_NUMBER,
    apiKeyPresent: apiKey.length > 0,
    publicKeyPresent: publicKey.length > 0,
    expectedWebhookUrl,
    expectedProfileId: senderRow.messagingProfileId,
    senderRow,
    number: facts.number,
    messaging: facts.messaging,
    profile: facts.profile,
    lookupError: facts.error,
  });
}
