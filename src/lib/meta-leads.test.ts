import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractMetaLeadEvents,
  mapMetaLead,
  verifyMetaChallenge,
  verifyMetaSignature,
} from "@/lib/meta-leads.server";

const event = { pageId: "61561932855620", formId: "12345", leadId: "98765" };

describe("Meta lead webhook boundary", () => {
  it("accepts only a valid SHA-256 signature over the unmodified body", () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, signature, "app-secret")).toBe(true);
    expect(verifyMetaSignature(`${body} `, signature, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, signature, "different-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=bad", "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, signature, "")).toBe(false);
  });

  it("only echoes the challenge for the configured verification token", () => {
    const url = new URL("https://example.com/api/public/meta/leads?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123");
    expect(verifyMetaChallenge(url, "abc")).toBe("123");
    expect(verifyMetaChallenge(url, "xyz")).toBeNull();
  });

  it("ignores other pages and event types in a signed batch", () => {
    const payload = { object: "page", entry: [
      { id: "other", changes: [{ field: "leadgen", value: {
        page_id: "other", form_id: "1", leadgen_id: "2" } }] },
      { id: event.pageId, changes: [
        { field: "feed", value: {} },
        { field: "leadgen", value: { page_id: event.pageId,
          form_id: event.formId, leadgen_id: event.leadId } },
      ] },
    ] };
    expect(extractMetaLeadEvents(payload, event.pageId)).toEqual([event]);
  });

  it("maps verified Meta answers to inbox fields without assuming text consent", () => {
    const mapped = mapMetaLead({ id: event.leadId, form_id: event.formId,
      field_data: [
        { name: "full_name", values: ["Sam Test"] },
        { name: "phone_number", values: ["0412 345 678"] },
        { name: "email", values: ["sam@example.com"] },
        { name: "What detail?", values: ["Full Detail"] },
      ] }, event);
    expect(mapped).toMatchObject({ name: "Sam Test", mobile_number: "0412 345 678",
      email: "sam@example.com", source_channel: "meta", lead_origin: "inbound_form",
      external_id: "meta:98765", consent: false });
    expect(mapped.source_metadata.meta.answers["what detail?"]).toBe("Full Detail");
    expect(() => mapMetaLead({ id: "wrong", form_id: event.formId }, event)).toThrow();
  });
});
