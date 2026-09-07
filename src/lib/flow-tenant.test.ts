// TENANT FLOW — end-to-end, two fictional tenants side by side.
//
// Proves that everything a business sees and sends is derived from that
// business's own record: slug, mode, services, prices, offer, callback number,
// owner alert number, quote link and idempotency keys. No tenant identifier,
// business name or price lives in code.

import { describe, expect, it } from "vitest";
import { normaliseSlug, isValidSlug } from "@/lib/tenant-slug";
import { resolveQuoteMode, DEFAULT_QUOTE_MODE } from "@/lib/quote-mode";
import { isBookingOnlyTenant, BOOKING_ONLY_EXCLUDED_TENANTS, ownerBookingAlert } from "@/lib/booking-only-mode";
import { servicePriceLine, parseOfferPercent } from "@/lib/service-pricing";
import { resolveTenantCallbackNumber } from "@/lib/booking-confirmation";
import { resolveOwnerNotificationNumber, ownerBookingConfirmationIdempotencyKey } from "@/lib/owner-notification";
import { campaignQuoteUrl, proposeOffer, renderReactivationMessage } from "@/lib/reactivation";
import { welcomeMessage, serviceAcknowledgement, type WebChatTenant, type WebChatService } from "@/lib/web-chat";

const service = (over: Partial<WebChatService> & { id: string; name: string }): WebChatService => ({
  description: null,
  included_items: null,
  excluded_items: null,
  qualification_note: null,
  price_guidance: null,
  campaign_eligible: true,
  ...over,
});

const TENANT_A = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Coastal Shine Detailing",
  slug: "Coastal Shine ",
  phone_number: "+61288001234",
  owner_notification_number: "0412 000 111",
  quoteUrl: "https://example.test/quote/coastal-shine",
  services: [
    service({ id: "a1", name: "Full Detail", price_guidance: "from $250" }),
    service({ id: "a2", name: "Odour Treatment", price_guidance: "from $90", campaign_eligible: false }),
  ],
};

const TENANT_B = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Riverside Auto Care",
  slug: "riverside-auto-care",
  phone_number: null as string | null,
  owner_notification_number: "0455 222 333",
  quoteUrl: "https://example.test/quote/riverside-auto-care",
  services: [service({ id: "b1", name: "Express Wash" })], // no price entered
};

const chatTenant = (t: typeof TENANT_A | typeof TENANT_B, offerPercent?: number | null): WebChatTenant => ({
  name: t.name,
  flexibleRequestsEnabled: true,
  bookingEnabled: true,
  services: t.services,
  ...(offerPercent === undefined ? {} : { offerPercent }),
});

describe("tenant flow — 1. identity and public address", () => {
  it("resolves each tenant's page from its own slug only", () => {
    expect(normaliseSlug(TENANT_A.slug)).toBe("coastal-shine");
    expect(normaliseSlug(TENANT_B.slug)).toBe("riverside-auto-care");
    expect(normaliseSlug("  ")).toBeNull();
    expect(isValidSlug("not a slug!")).toBe(false);
  });

  it("an unknown mode never fails open into a different experience", () => {
    expect(resolveQuoteMode("ai_chat")).toBe("ai_chat");
    expect(resolveQuoteMode("something_else")).toBe(DEFAULT_QUOTE_MODE);
    expect(resolveQuoteMode(null)).toBe(DEFAULT_QUOTE_MODE);
  });
});

describe("tenant flow — 2. booking-only is the default for every tenant", () => {
  it("applies to both tenants with no per-tenant configuration", () => {
    expect(BOOKING_ONLY_EXCLUDED_TENANTS).toHaveLength(0);
    expect(isBookingOnlyTenant(TENANT_A.id)).toBe(true);
    expect(isBookingOnlyTenant(TENANT_B.id)).toBe(true);
  });

  it("an empty business id is never treated as a tenant", () => {
    expect(isBookingOnlyTenant("")).toBe(false);
    expect(isBookingOnlyTenant("   ")).toBe(false);
  });
});

describe("tenant flow — 3. customer-facing copy comes from tenant data", () => {
  it("the welcome line names the tenant's own business", () => {
    expect(welcomeMessage(chatTenant(TENANT_A))).toContain(TENANT_A.name);
    expect(welcomeMessage(chatTenant(TENANT_B))).toContain(TENANT_B.name);
    expect(welcomeMessage(chatTenant(TENANT_B))).not.toContain(TENANT_A.name);
  });

  it("shows each tenant's own price verbatim, and no price when none is entered", () => {
    expect(
      serviceAcknowledgement(chatTenant(TENANT_A), { service_id: "a1", service_name: "Full Detail" }),
    ).toBe("Full Detail — from $250.");
    expect(
      serviceAcknowledgement(chatTenant(TENANT_B), { service_id: "b1", service_name: "Express Wash" }),
    ).toBe("Express Wash, got it.");
  });

  it("highlights a campaign percentage only on services the tenant marked eligible", () => {
    const percent = parseOfferPercent(proposeOffer({ percent: 15 }));
    expect(percent).toBe(15);
    expect(servicePriceLine(TENANT_A.services[0]!, percent)).toBe("from $250 — 15% off with your offer");
    expect(servicePriceLine(TENANT_A.services[1]!, percent)).toBe("from $90");
    expect(servicePriceLine(TENANT_B.services[0]!, percent)).toBeNull();
  });
});

describe("tenant flow — 4. each tenant's own numbers", () => {
  it("customers are told to call the tenant's own mobile, falling back to its business line", () => {
    expect(resolveTenantCallbackNumber(TENANT_A)).toBe("+61412000111");
    expect(resolveTenantCallbackNumber(TENANT_B)).toBe("+61455222333");
    expect(resolveTenantCallbackNumber({ phone_number: null, owner_notification_number: null })).toBeNull();
  });

  it("owner alerts go to the tenant's own stored mobile and nowhere else", () => {
    expect(resolveOwnerNotificationNumber(TENANT_A)).toBe("+61412000111");
    expect(resolveOwnerNotificationNumber(TENANT_B)).toBe("+61455222333");
    expect(resolveOwnerNotificationNumber({ owner_notification_number: "+61288001234" })).toBeNull();
  });
});

describe("tenant flow — 5. isolation of links, alerts and send keys", () => {
  it("win-back links carry the tenant's own page and the contact's own token", () => {
    expect(campaignQuoteUrl(TENANT_A.quoteUrl, "tok-a")).toBe(`${TENANT_A.quoteUrl}?c=tok-a`);
    expect(campaignQuoteUrl(TENANT_B.quoteUrl, "tok-b")).toBe(`${TENANT_B.quoteUrl}?c=tok-b`);
    expect(campaignQuoteUrl(null, "tok-a")).toBeNull();
  });

  it("a win-back message names only the sending tenant", () => {
    const body = renderReactivationMessage({
      businessName: TENANT_B.name,
      leadName: "Dana Fields",
      offerText: proposeOffer(),
      quoteUrl: TENANT_B.quoteUrl,
    });
    expect(body).toContain("Hi Dana");
    expect(body).toContain(TENANT_B.name);
    expect(body).not.toContain(TENANT_A.name);
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("owner alerts and confirmation keys are scoped per tenant and per booking", () => {
    const alertA = ownerBookingAlert({
      businessId: TENANT_A.id,
      leadId: "lead-1",
      offerId: "offer-1",
      customerName: "Dana",
      serviceName: "Full Detail",
      slotLabel: "Tue 9:00am",
    });
    const alertB = ownerBookingAlert({
      businessId: TENANT_B.id,
      leadId: "lead-1",
      offerId: "offer-1",
      customerName: "Dana",
      serviceName: "Express Wash",
      slotLabel: "Tue 9:00am",
    });
    expect(alertA.idempotencyKey).not.toBe(alertB.idempotencyKey);
    expect(alertA.idempotencyKey).toContain(TENANT_A.id);
    expect(ownerBookingConfirmationIdempotencyKey("offer-1")).not.toBe("offer-1");
  });
});
