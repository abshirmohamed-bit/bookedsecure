import { describe, expect, it } from "vitest";
import {
  buildAttribution,
  deriveSourceChannel,
  formIdempotencyKey,
  isFormIdempotencyKey,
  requiresOwnerReview,
  validateSelection,
} from "./quote-form";

describe("quote form selection rules", () => {
  it("requires a request type", () => {
    expect(
      validateSelection(
        { request_type: null, approved_service_id: null, flexible_request_text: null },
        { flexibleEnabled: true },
      ),
    ).toEqual(["request_type_required"]);
  });

  it("accepts an approved service without a description", () => {
    expect(
      validateSelection(
        { request_type: "quote", approved_service_id: "svc-1", flexible_request_text: null },
        { flexibleEnabled: false },
      ),
    ).toEqual([]);
  });

  it("requires a service or a description", () => {
    expect(
      validateSelection(
        { request_type: "service", approved_service_id: null, flexible_request_text: "" },
        { flexibleEnabled: true },
      ),
    ).toEqual(["service_or_description_required"]);
  });

  it("rejects a flexible request when the tenant has not enabled it", () => {
    expect(
      validateSelection(
        { request_type: "service", approved_service_id: null, flexible_request_text: "ceramic maybe" },
        { flexibleEnabled: false },
      ),
    ).toEqual(["flexible_not_enabled"]);
  });

  it("requires a description for a recommendation request", () => {
    expect(
      validateSelection(
        { request_type: "recommendation", approved_service_id: null, flexible_request_text: null },
        { flexibleEnabled: false },
      ),
    ).toEqual(["flexible_text_required"]);
  });

  it("flags flexible and recommendation requests for owner review only", () => {
    expect(requiresOwnerReview({ request_type: "recommendation", approved_service_id: "svc-1" })).toBe(true);
    expect(requiresOwnerReview({ request_type: "quote", approved_service_id: null })).toBe(true);
    expect(requiresOwnerReview({ request_type: "quote", approved_service_id: "svc-1" })).toBe(false);
  });
});

describe("attribution", () => {
  it("identifies Meta traffic explicitly", () => {
    expect(deriveSourceChannel({ source: "facebook" })).toBe("meta");
    expect(deriveSourceChannel({ fbclid: "abc" })).toBe("meta");
    expect(deriveSourceChannel({ utm_source: "facebook" })).toBe("hosted_page");
    expect(deriveSourceChannel({})).toBe("hosted_page");
  });

  it("preserves non-column values in metadata", () => {
    const attribution = buildAttribution({
      slug: "glocast",
      params: { utm_source: "meta", utm_campaign: "winter", ad_id: "123", fbclid: "xyz" },
      formUrl: "https://example.com/quote/glocast",
      referrer: "https://facebook.com/",
    });
    expect(attribution.source_channel).toBe("meta");
    expect(attribution.utm_campaign).toBe("winter");
    expect(attribution.source_form).toBe("quote_form:glocast");
    expect(attribution.metadata).toMatchObject({
      tenant_slug: "glocast",
      ad_id: "123",
      fbclid: "xyz",
      referrer: "https://facebook.com/",
      landing_page: "https://example.com/quote/glocast",
    });
  });
});

describe("submission idempotency", () => {
  const base = {
    businessId: "biz-1",
    mobile: "+61400000000",
    requestType: "quote",
    nonce: "nonce-a",
  };

  it("is stable for identical retries", () => {
    expect(formIdempotencyKey(base)).toBe(formIdempotencyKey({ ...base }));
    expect(isFormIdempotencyKey(formIdempotencyKey(base))).toBe(true);
  });

  it("differs for a new submission session", () => {
    expect(formIdempotencyKey({ ...base, nonce: "nonce-b" })).not.toBe(formIdempotencyKey(base));
  });

  it("differs across tenants, numbers and request types", () => {
    expect(formIdempotencyKey({ ...base, businessId: "biz-2" })).not.toBe(formIdempotencyKey(base));
    expect(formIdempotencyKey({ ...base, mobile: "+61400000001" })).not.toBe(formIdempotencyKey(base));
    expect(formIdempotencyKey({ ...base, requestType: "service" })).not.toBe(formIdempotencyKey(base));
  });
});
