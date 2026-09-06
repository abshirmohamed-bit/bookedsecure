// Continuity for a contact who comes back.
//
// A dormant/imported contact who later makes a real enquiry must land on their
// OWN record: one profile, one history. This module is the pure description of
// what a fresh enquiry may write onto an existing lead row.
//
// Rules:
//  - never blank an existing value,
//  - never overwrite a value the tenant or a previous enquiry already recorded,
//  - only fill fields that are currently empty, plus the enquiry-lifecycle
//    columns that a new enquiry legitimately resets.
//
// Pure: no I/O, no tenant identifiers.

export type ExistingLeadFields = {
  name?: string | null;
  email?: string | null;
  suburb?: string | null;
  vehicle_type?: string | null;
  last_cleaned_at?: string | null;
  main_concerns?: string | null;
  service_intent?: string | null;
  request_type?: string | null;
  approved_service_id?: string | null;
  service_name_snapshot?: string | null;
  flexible_request_text?: string | null;
  external_id?: string | null;
};

export type IncomingEnquiryFields = ExistingLeadFields & {
  source_channel?: string | null;
  source_form?: string | null;
  source_campaign?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  lead_origin?: string | null;
  requires_owner_review?: boolean;
  source_metadata?: Record<string, unknown> | null;
};

const FILL_ONLY_FIELDS = [
  "name",
  "email",
  "suburb",
  "vehicle_type",
  "last_cleaned_at",
  "main_concerns",
  "external_id",
] as const;

/** Placeholder names carry no information and must never win over a real one. */
const PLACEHOLDER_NAMES = new Set(["web visitor", "unknown", "customer", "-", "n/a"]);

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function usableName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 1 && !PLACEHOLDER_NAMES.has(trimmed.toLowerCase());
}

/**
 * The patch a returning contact's new enquiry writes onto their existing lead.
 * Enquiry-lifecycle columns (status, readiness, the current request and its
 * source) are refreshed, because they describe THIS enquiry; descriptive
 * profile fields are only filled when empty.
 */
export function mergeReturningLead(
  existing: ExistingLeadFields,
  incoming: IncomingEnquiryFields,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const field of FILL_ONLY_FIELDS) {
    const value = incoming[field];
    if (isEmpty(value)) continue;
    if (field === "name" && !usableName(value)) continue;
    if (!isEmpty(existing[field])) continue;
    patch[field] = value;
  }

  // The current request always describes the newest enquiry.
  if (!isEmpty(incoming.service_intent)) patch["service_intent"] = incoming.service_intent;
  if (!isEmpty(incoming.request_type)) patch["request_type"] = incoming.request_type;
  if (!isEmpty(incoming.approved_service_id)) patch["approved_service_id"] = incoming.approved_service_id;
  if (!isEmpty(incoming.service_name_snapshot))
    patch["service_name_snapshot"] = incoming.service_name_snapshot;
  if (!isEmpty(incoming.flexible_request_text))
    patch["flexible_request_text"] = incoming.flexible_request_text;
  if (!isEmpty(incoming.source_channel)) patch["source_channel"] = incoming.source_channel;
  if (!isEmpty(incoming.source_form)) patch["source_form"] = incoming.source_form;
  if (!isEmpty(incoming.source_campaign)) patch["source_campaign"] = incoming.source_campaign;
  if (!isEmpty(incoming.utm_source)) patch["utm_source"] = incoming.utm_source;
  if (!isEmpty(incoming.utm_campaign)) patch["utm_campaign"] = incoming.utm_campaign;
  if (!isEmpty(incoming.lead_origin)) patch["lead_origin"] = incoming.lead_origin;
  if (incoming.source_metadata) patch["source_metadata"] = incoming.source_metadata;
  if (incoming.requires_owner_review === true) patch["requires_owner_review"] = true;

  // A returning contact with a live enquiry is an active lead again.
  patch["status"] = "new";
  patch["readiness_classification"] = "new";

  return patch;
}
