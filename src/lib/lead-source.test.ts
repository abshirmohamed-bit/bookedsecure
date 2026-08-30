import { describe, expect, it } from "vitest";
import {
  GODADDY_SOURCE_CHANNEL,
  importMethodLabel,
  isNativeFacebookLead,
  leadSourceLabel,
  originalSourceDetails,
  sourceAttribution,
} from "@/lib/lead-source";
import { SOURCE_CHANNELS, SOURCE_LABELS } from "@/lib/domain";

const importedMetadata = {
  platform: "facebook",
  platform_raw: "fb",
  created_time_raw: "1/13/26",
  original_source: {
    channel: "meta",
    platform: "facebook",
    form_name: "ASB Marketing-copy",
    campaign_name: "ASB",
    created_time: "1/13/26",
  },
  import: {
    origin: "crm_import",
    batch_id: "2d1136af-2a0f-456a-8c97-19bdd4eaf58f",
    row_number: 1,
    idempotency_key: "crm-import:2d1136af-2a0f-456a-8c97-19bdd4eaf58f:row:1",
    source_channel_raw: "fb",
    raw_row: { form_name: "ASB Marketing-copy", campaign_name: "ASB", created_time: "1/13/26" },
  },
};

const importedLead = {
  source_channel: GODADDY_SOURCE_CHANNEL,
  lead_origin: "crm_import",
  source_metadata: importedMetadata,
};

const nativeFacebookLead = { source_channel: "meta", lead_origin: null, source_metadata: null };

describe("source attribution display", () => {
  it("labels GoDaddy CRM records as Website / GoDaddy", () => {
    expect(leadSourceLabel(importedLead)).toBe("Website / GoDaddy");
    expect(SOURCE_LABELS[GODADDY_SOURCE_CHANNEL]).toBe("Website / GoDaddy");
    expect(SOURCE_CHANNELS).toContain(GODADDY_SOURCE_CHANNEL);
  });

  it("keeps import method separate from original source", () => {
    expect(importMethodLabel(importedLead)).toBe("CRM CSV");
    expect(importMethodLabel(nativeFacebookLead)).toBeNull();
  });

  it("keeps native Facebook leads separately identifiable", () => {
    expect(isNativeFacebookLead(nativeFacebookLead)).toBe(true);
    expect(leadSourceLabel(nativeFacebookLead)).toBe("Meta");
    expect(isNativeFacebookLead(importedLead)).toBe(false);
    // A CRM-imported row must never present as native Facebook, even if it
    // somehow still carries the meta channel.
    expect(isNativeFacebookLead({ source_channel: "meta", lead_origin: "crm_import" })).toBe(false);
  });

  it("preserves the original channel, platform, form, campaign and created date", () => {
    const original = originalSourceDetails(importedMetadata);
    expect(original).toEqual({
      channel: "meta",
      platform: "facebook",
      form: "ASB Marketing-copy",
      campaign: "ASB",
      createdAt: "1/13/26",
    });
  });

  it("falls back to raw import metadata when no original_source block exists", () => {
    const original = originalSourceDetails({
      platform: "facebook",
      created_time_raw: "1/13/26",
      import: {
        source_channel_raw: "fb",
        raw_row: { form_name: "ASB Marketing-copy", campaign_name: "ASB" },
      },
    });
    expect(original.platform).toBe("facebook");
    expect(original.form).toBe("ASB Marketing-copy");
    expect(original.campaign).toBe("ASB");
    expect(original.createdAt).toBe("1/13/26");
  });

  it("handles leads with no metadata without crashing", () => {
    expect(originalSourceDetails(null)).toEqual({
      channel: null,
      platform: null,
      form: null,
      campaign: null,
      createdAt: null,
    });
    expect(() => sourceAttribution(nativeFacebookLead)).not.toThrow();
  });

  it("is read-only: attribution never mutates the lead or its metadata", () => {
    const snapshot = JSON.stringify(importedLead);
    sourceAttribution(importedLead);
    expect(JSON.stringify(importedLead)).toBe(snapshot);
  });
});
