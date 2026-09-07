// Pure price presentation for the public quote conversation.
//
// Rules that must not change:
// - A price is only ever the tenant's own `price_guidance` text, shown verbatim.
//   Nothing here computes, discounts or invents a dollar figure.
// - A campaign discount is only ever HIGHLIGHTED as a percentage next to that
//   text, and only for services the tenant marked as campaign eligible.

export type PricedService = {
  price_guidance?: string | null;
  campaign_eligible?: boolean | null;
};

/** Reads the headline percentage out of a tenant-approved offer text ("15% off…"). */
export function parseOfferPercent(offerText: string | null | undefined): number | null {
  if (!offerText) return null;
  const match = /(\d{1,2})\s*%/.exec(offerText);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 99) return null;
  return percent;
}

/** True when a campaign discount may be highlighted for this service. */
export function isCampaignEligible(service: PricedService): boolean {
  return service.campaign_eligible !== false;
}

/**
 * The customer-facing price fragment for a service, or null when the tenant has
 * not entered price guidance (in which case no price is shown at all).
 */
export function servicePriceLine(
  service: PricedService,
  offerPercent?: number | null,
): string | null {
  const price = service.price_guidance?.trim();
  if (!price) return null;
  const percent = offerPercent ?? null;
  if (percent !== null && percent > 0 && isCampaignEligible(service)) {
    return `${price} — ${percent}% off with your offer`;
  }
  return price;
}
