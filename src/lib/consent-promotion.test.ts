import { describe, expect, it } from "vitest";
import {
  buildConsentPromotion,
  consentPromotionPatch,
  DEFAULT_CONSENT_TEXT,
} from "@/lib/consent-promotion";

const AT = "2026-09-04T09:58:16.577Z";
const TEXT =
  "I agree to Glocast contacting me about this enquiry, including by SMS. Reply STOP at any time to opt out.";

const capture = (over: Partial<Parameters<typeof buildConsentPromotion>[0]> = {}) => ({
  consented: true as const,
  consentText: TEXT,
  sourceChannel: "website",
  sourceForm: "ai_chat:glocast",
  formUrl: "https://bookedsecure.lovable.app/quote/glocast",
  at: AT,
  ...over,
});

describe("consent promotion", () => {
  it("promotes consent for a listed-service enquiry", () => {
    const promotion = buildConsentPromotion(capture());
    expect(promotion.consent_status).toBe("granted");
    expect(promotion.consent_source).toBe("website");
    expect(promotion.consent_record).toEqual({
      consented: true,
      at: AT,
      text: TEXT,
      source_channel: "website",
      source_form: "ai_chat:glocast",
      form_url: "https://bookedsecure.lovable.app/quote/glocast",
    });
  });

  it("promotes consent for an unlisted / recommendation-type enquiry", () => {
    // No approved service exists on this branch; consent must still be promoted.
    const promotion = buildConsentPromotion(capture());
    expect(promotion.consent_status).toBe("granted");
    expect(promotion.consent_source).toBe("website");
  });

  it("emits no owner-review, lead-context or booking fields", () => {
    const keys = Object.keys(buildConsentPromotion(capture()));
    expect(keys.sort()).toEqual(["consent_record", "consent_source", "consent_status"]);
  });

  it("is idempotent for a lead that is already granted", () => {
    expect(consentPromotionPatch({ consent_status: "granted" }, capture())).toEqual({});
  });

  it("repairs a lead whose consent evidence was never promoted", () => {
    expect(consentPromotionPatch({ consent_status: "unknown" }, capture())).toEqual({
      consent_status: "granted",
      consent_source: "website",
    });
  });

  it("leaves a declined capture non-granted", () => {
    const promotion = buildConsentPromotion(capture({ consented: false }));
    expect(promotion.consent_record).toBeNull();
    expect(promotion.consent_status).toBeUndefined();
    expect(promotion.consent_source).toBeUndefined();
    expect(consentPromotionPatch({ consent_status: "unknown" }, capture({ consented: false }))).toEqual(
      {},
    );
  });

  it("leaves a CRM-imported lead with no capture as unknown", () => {
    const promotion = buildConsentPromotion({ consented: undefined, at: AT });
    expect(promotion.consent_record).toBeNull();
    expect(promotion.consent_status).toBeUndefined();
  });

  it("never overrides an opt-out or suppression", () => {
    expect(consentPromotionPatch({ consent_status: "unknown", opted_out_at: AT }, capture())).toEqual({});
    expect(
      consentPromotionPatch({ consent_status: "unknown", sms_suppressed_at: AT }, capture()),
    ).toEqual({});
  });

  it("uses the supplied server timestamp and default text only when absent", () => {
    const promotion = buildConsentPromotion(capture({ consentText: null }));
    expect(promotion.consent_record?.text).toBe(DEFAULT_CONSENT_TEXT);
    expect(promotion.consent_record?.at).toBe(AT);
  });
});
