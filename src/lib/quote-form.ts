// Pure quote-form domain rules: request types, required fields, attribution and idempotency.
// No database, no network — safe to import from browser code and unit tests.

export const REQUEST_TYPES = ["quote", "service", "recommendation"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  quote: "I'd like a quote",
  service: "I'd like to arrange a service",
  recommendation: "I'd like a recommendation",
};

export const REQUEST_TYPE_HELP: Record<RequestType, string> = {
  quote: "Tell us about the vehicle and we'll text back with the right option.",
  service: "Pick the service you want, or describe it if you're not sure.",
  recommendation: "Describe the condition and we'll suggest what suits it best.",
};

export function isRequestType(value: unknown): value is RequestType {
  return typeof value === "string" && (REQUEST_TYPES as readonly string[]).includes(value);
}

/** Marker used when the customer picks "Something else or not sure". */
export const FLEXIBLE_SERVICE_VALUE = "__flexible__";

export type QuoteSelection = {
  request_type: RequestType;
  /** Approved service id, or null when the request is flexible. */
  approved_service_id: string | null;
  flexible_request_text: string | null;
};

export type SelectionIssue =
  | "request_type_required"
  | "service_or_description_required"
  | "flexible_text_required"
  | "flexible_not_enabled";

/**
 * A request must be routable: either an approved service, or (when the tenant allows it)
 * a described flexible request. "Recommendation" never requires a service selection.
 */
export function validateSelection(
  selection: {
    request_type: string | null;
    approved_service_id: string | null;
    flexible_request_text: string | null;
  },
  options: { flexibleEnabled: boolean },
): SelectionIssue[] {
  const issues: SelectionIssue[] = [];
  if (!isRequestType(selection.request_type)) {
    issues.push("request_type_required");
    return issues;
  }

  const described = (selection.flexible_request_text ?? "").trim().length > 1;
  const hasService = Boolean(selection.approved_service_id);

  if (selection.request_type === "recommendation") {
    if (!described) issues.push("flexible_text_required");
    return issues;
  }

  if (!hasService && !described) issues.push("service_or_description_required");
  if (!hasService && described && !options.flexibleEnabled) issues.push("flexible_not_enabled");
  return issues;
}

/** A flexible request always needs a human before anything is sent. */
export function requiresOwnerReview(selection: {
  request_type: string | null;
  approved_service_id: string | null;
}): boolean {
  return selection.request_type === "recommendation" || !selection.approved_service_id;
}

export type Attribution = {
  source_channel: string;
  source_form: string | null;
  source_campaign: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  metadata: Record<string, string>;
};

const METADATA_KEYS = [
  "utm_medium",
  "utm_content",
  "utm_term",
  "ad_id",
  "adset_id",
  "campaign_id",
  "fbclid",
  "gclid",
  "referrer",
  "landing_page",
] as const;

/** Meta-originated traffic is identified explicitly, never inferred from utm_source alone. */
export function deriveSourceChannel(params: Record<string, string | null | undefined>): string {
  const explicit = (params["source"] ?? "").toLowerCase();
  if (explicit === "meta" || explicit === "facebook" || explicit === "instagram") return "meta";
  if (params["fbclid"]) return "meta";
  if (explicit === "website" || explicit === "godaddy") return explicit;
  return "hosted_page";
}

/**
 * Captures everything the browser knows about the visit. Column-backed values stay in columns;
 * every other captured value is preserved verbatim in metadata (stored in source_metadata).
 */
export function buildAttribution(input: {
  slug: string;
  params: Record<string, string | null | undefined>;
  formUrl?: string | null;
  referrer?: string | null;
}): Attribution {
  const params = input.params;
  const metadata: Record<string, string> = { tenant_slug: input.slug };

  for (const key of METADATA_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) metadata[key] = value.trim();
  }
  if (input.referrer && !metadata["referrer"]) metadata["referrer"] = input.referrer;
  if (input.formUrl && !metadata["landing_page"]) metadata["landing_page"] = input.formUrl;

  return {
    source_channel: deriveSourceChannel(params),
    source_form: params["form"]?.trim() || `quote_form:${input.slug}`,
    source_campaign: params["campaign_id"]?.trim() || params["utm_campaign"]?.trim() || null,
    utm_source: params["utm_source"]?.trim() || null,
    utm_campaign: params["utm_campaign"]?.trim() || null,
    metadata,
  };
}

/** Stable, non-cryptographic hash. Same input always yields the same key. */
function stableHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = (h1 ^ code) * 0x01000193;
    h2 = (h2 + code * (index + 1)) * 0x85ebca6b;
    h1 >>>= 0;
    h2 >>>= 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

export const FORM_IDEMPOTENCY_PREFIX = "form:";

/**
 * Deterministic per-submission key stored in leads.external_id.
 * - Same submission retried (same nonce) → same key → the existing lead is reused, never rewritten.
 * - A genuinely new enquiry carries a new nonce → new key → a new lead is created.
 * - Tenant scoping comes from the unique index on (business_id, external_id).
 */
export function formIdempotencyKey(input: {
  businessId: string;
  mobile: string;
  requestType: string;
  nonce: string;
}): string {
  const canonical = [
    input.businessId.trim().toLowerCase(),
    input.mobile.trim(),
    input.requestType.trim().toLowerCase(),
    input.nonce.trim(),
  ].join("|");
  return `${FORM_IDEMPOTENCY_PREFIX}${stableHash(canonical)}`;
}

export function isFormIdempotencyKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(FORM_IDEMPOTENCY_PREFIX);
}

/** Nonce for one form session. Regenerated only when the customer starts a new enquiry. */
export function createSubmissionNonce(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return random.replace(/-/g, "").slice(0, 24);
}
