// Pure normaliser for the public lead intake webhook (Zapier, n8n, website
// embeds, raw Meta Lead Ads payloads). Accepts BookedSecure field names, Meta's
// own field names and Meta's `field_data` array, and only rejects a lead when
// there is no usable phone number: over-long answers are trimmed and a bad
// email is dropped instead of losing the whole enquiry.

export const INTAKE_SOURCE_CHANNELS = [
  "meta",
  "website",
  "hosted_page",
  "manual",
  "unknown",
] as const;
export type IntakeSourceChannel = (typeof INTAKE_SOURCE_CHANNELS)[number];

export type IntakeLead = {
  name: string;
  mobile_number: string;
  email: string | null;
  suburb: string | null;
  vehicle_type: string | null;
  last_cleaned_at: string | null;
  main_concerns: string | null;
  service_intent: string | null;
  source_channel: IntakeSourceChannel;
  source_campaign: string | null;
  source_form: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  consent: boolean;
  external_id: string | null;
  /** Business slug requested in the body; the query string wins in the route. */
  business_slug: string | null;
};

export type IntakeResult = { ok: true; lead: IntakeLead } | { ok: false; error: string };

const LIMITS = {
  name: 80,
  mobile_number: 20,
  email: 120,
  suburb: 80,
  vehicle_type: 60,
  last_cleaned_at: 60,
  main_concerns: 500,
  service_intent: 120,
  source_campaign: 80,
  source_form: 80,
  utm_source: 80,
  utm_campaign: 80,
  external_id: 120,
  business_slug: 80,
} as const;

const ALIASES: Record<string, readonly string[]> = {
  name: ["name", "full_name", "fullname", "customer_name", "contact_name"],
  first_name: ["first_name", "firstname", "given_name"],
  last_name: ["last_name", "lastname", "surname", "family_name"],
  mobile_number: [
    "mobile_number",
    "mobile",
    "phone_number",
    "phone",
    "mobile_phone",
    "cell",
    "contact_number",
  ],
  email: ["email", "email_address", "work_email"],
  suburb: ["suburb", "city", "location", "area"],
  post_code: ["post_code", "postcode", "zip_code", "zip", "postal_code"],
  vehicle_type: ["vehicle_type", "vehicle", "car", "car_type", "vehicle_make_model"],
  last_cleaned_at: ["last_cleaned_at", "last_cleaned", "last_detailed", "last_clean"],
  main_concerns: ["main_concerns", "concerns", "message", "notes", "comments", "details"],
  service_intent: ["service_intent", "service", "services", "service_type", "package"],
  source_channel: ["source_channel", "source", "platform", "channel"],
  source_campaign: ["source_campaign", "campaign_name", "campaign", "ad_name", "adset_name"],
  source_form: ["source_form", "form_name", "form", "form_id"],
  utm_source: ["utm_source"],
  utm_campaign: ["utm_campaign"],
  consent: ["consent", "sms_consent", "marketing_consent", "opt_in"],
  external_id: ["external_id", "leadgen_id", "lead_id", "meta_lead_id"],
  business_slug: ["business", "business_slug", "tenant"],
};

const KNOWN_KEYS = new Set<string>([
  ...Object.values(ALIASES).flat(),
  "id",
  "created_time",
  "field_data",
  "fields",
  "ad_id",
  "adset_id",
  "campaign_id",
  "page_id",
  "is_organic",
  "platform_id",
]);

function normaliseKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[?.!:]+$/g, "")
    .replace(/[\s\-/]+/g, "_");
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parts = value.map(scalar).filter((v): v is string => !!v);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}

/** Flattens top-level keys plus Meta's `field_data: [{ name, values }]` answers. */
export function flattenIntakePayload(body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  const record = body as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const text = scalar(value);
    if (text !== null) out.set(normaliseKey(key), text);
  }

  for (const listKey of ["field_data", "fields"]) {
    const list = record[listKey];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const { name, values, value } = entry as {
        name?: unknown;
        values?: unknown;
        value?: unknown;
      };
      if (typeof name !== "string") continue;
      const text = scalar(values ?? value);
      // Meta answers take precedence over generic top-level duplicates.
      if (text !== null) out.set(normaliseKey(name), text);
    }
  }

  // Meta's lead id arrives as `id` alongside field_data; elsewhere `id` is too generic.
  if (Array.isArray(record["field_data"]) && !out.has("leadgen_id")) {
    const id = scalar(record["id"]);
    if (id) out.set("leadgen_id", id);
  }
  return out;
}

function pick(fields: Map<string, string>, field: keyof typeof ALIASES): string | null {
  for (const alias of ALIASES[field] ?? []) {
    const value = fields.get(alias);
    if (value) return value;
  }
  return null;
}

export function mapSourceChannel(raw: string | null, looksLikeMeta = false): IntakeSourceChannel {
  if (!raw) return looksLikeMeta ? "meta" : "website";
  const value = raw.trim().toLowerCase();
  if ((INTAKE_SOURCE_CHANNELS as readonly string[]).includes(value))
    return value as IntakeSourceChannel;
  if (
    /^(fb|ig)$/.test(value) ||
    /facebook|instagram|\bmeta\b|messenger|paid[_ ]social|lead[_ ]?ads?/.test(value)
  ) {
    return "meta";
  }
  if (/^(web|site|form|website[_ ]form|embed)$/.test(value)) return "website";
  return "unknown";
}

function parseConsent(raw: string | null): boolean {
  if (!raw) return false;
  return /^(true|yes|y|1|on|agree|agreed|checked)$/i.test(raw.trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises any supported payload into an intake lead. A missing channel
 * stays "website" (the historical default) unless the payload carries Meta
 * lead markers such as field_data or a leadgen id.
 */
export function normaliseIntakePayload(body: unknown): IntakeResult {
  const fields = flattenIntakePayload(body);
  if (fields.size === 0)
    return { ok: false, error: "Payload must be a JSON object with lead fields." };

  const mobileRaw = pick(fields, "mobile_number");
  const digits = (mobileRaw ?? "").replace(/\D/g, "");
  if (!mobileRaw || digits.length < 8) {
    return { ok: false, error: "No usable phone number (expected mobile_number or phone_number)." };
  }

  const joined = [pick(fields, "first_name"), pick(fields, "last_name")].filter(Boolean).join(" ");
  const name = clip(pick(fields, "name") ?? (joined || null), LIMITS.name) ?? "New enquiry";

  const emailRaw = pick(fields, "email");
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? clip(emailRaw, LIMITS.email) : null;

  const suburb = pick(fields, "suburb") ?? pick(fields, "post_code");

  // Custom Meta questions that match no known field are kept for the owner.
  const extras: string[] = [];
  const usedAliases = new Set(Object.values(ALIASES).flat());
  for (const [key, value] of fields) {
    if (usedAliases.has(key) || KNOWN_KEYS.has(key)) continue;
    extras.push(`${key.replace(/_/g, " ")}: ${value}`);
  }
  const concerns = [pick(fields, "main_concerns"), ...extras].filter(Boolean).join("\n");

  return {
    ok: true,
    lead: {
      name: name.length >= 2 ? name : "New enquiry",
      mobile_number: clip(mobileRaw.trim(), LIMITS.mobile_number) as string,
      email,
      suburb: clip(suburb, LIMITS.suburb),
      vehicle_type: clip(pick(fields, "vehicle_type"), LIMITS.vehicle_type),
      last_cleaned_at: clip(pick(fields, "last_cleaned_at"), LIMITS.last_cleaned_at),
      main_concerns: clip(concerns || null, LIMITS.main_concerns),
      service_intent: clip(pick(fields, "service_intent"), LIMITS.service_intent),
      source_channel: mapSourceChannel(
        pick(fields, "source_channel"),
        Array.isArray((body as Record<string, unknown>)["field_data"]) ||
          fields.has("leadgen_id") ||
          fields.has("form_id") ||
          fields.has("ad_id"),
      ),
      source_campaign: clip(pick(fields, "source_campaign"), LIMITS.source_campaign),
      source_form: clip(pick(fields, "source_form"), LIMITS.source_form),
      utm_source: clip(pick(fields, "utm_source"), LIMITS.utm_source),
      utm_campaign: clip(pick(fields, "utm_campaign"), LIMITS.utm_campaign),
      consent: parseConsent(pick(fields, "consent")),
      external_id: clip(pick(fields, "external_id"), LIMITS.external_id),
      business_slug: clip(pick(fields, "business_slug"), LIMITS.business_slug),
    },
  };
}
