// Pure, read-only source attribution helpers.
//
// Two different facts are kept apart on purpose:
//   * original source  — where the enquiry actually came from (e.g. GoDaddy)
//   * import method    — how the record reached BookedSecure (e.g. CRM CSV)
//
// Nothing here writes data; it only derives display values from a lead row and
// its preserved import metadata.

import { SOURCE_LABELS } from "@/lib/domain";

export const GODADDY_SOURCE_CHANNEL = "godaddy";
export const CRM_IMPORT_ORIGIN = "crm_import";

export type AttributableLead = {
  source_channel: string;
  lead_origin?: string | null;
};

/** Human label for where the enquiry originated. */
export function leadSourceLabel(lead: AttributableLead): string {
  return SOURCE_LABELS[lead.source_channel] ?? lead.source_channel;
}

/** How the record entered the app, when that differs from the original source. */
export function importMethodLabel(lead: AttributableLead): string | null {
  return lead.lead_origin === CRM_IMPORT_ORIGIN ? "CRM CSV" : null;
}

/**
 * True only for enquiries that actually arrived through the native
 * Facebook/Meta integration — never for CRM-imported historical records.
 */
export function isNativeFacebookLead(lead: AttributableLead): boolean {
  return lead.source_channel === "meta" && lead.lead_origin !== CRM_IMPORT_ORIGIN;
}

export type OriginalSourceDetails = {
  channel: string | null;
  platform: string | null;
  form: string | null;
  campaign: string | null;
  createdAt: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Reads the preserved pre-relabel attribution (channel, platform, form,
 * campaign, created date) out of `source_metadata`.
 */
export function originalSourceDetails(
  sourceMetadata: Record<string, unknown> | null | undefined,
): OriginalSourceDetails {
  const meta = sourceMetadata ?? {};
  const original = (meta["original_source"] ?? {}) as Record<string, unknown>;
  const importInfo = (meta["import"] ?? {}) as Record<string, unknown>;
  const raw = (importInfo["raw_row"] ?? {}) as Record<string, unknown>;

  return {
    channel: text(original["channel"]),
    platform:
      text(original["platform"]) ??
      text(meta["platform"]) ??
      text(importInfo["source_channel_raw"]) ??
      text(raw["platform"]),
    form: text(original["form_name"]) ?? text(meta["form_name"]) ?? text(raw["form_name"]),
    campaign:
      text(original["campaign_name"]) ?? text(meta["campaign_name"]) ?? text(raw["campaign_name"]),
    createdAt:
      text(original["created_time"]) ??
      text(meta["created_time_raw"]) ??
      text(raw["created_time"]),
  };
}

/** Everything the UI needs to describe a lead's provenance, read-only. */
export function sourceAttribution(
  lead: AttributableLead & { source_metadata?: unknown },
): {
  sourceLabel: string;
  importMethod: string | null;
  nativeFacebook: boolean;
  original: OriginalSourceDetails;
} {
  return {
    sourceLabel: leadSourceLabel(lead),
    importMethod: importMethodLabel(lead),
    nativeFacebook: isNativeFacebookLead(lead),
    original: originalSourceDetails(
      (lead.source_metadata ?? null) as Record<string, unknown> | null,
    ),
  };
}
