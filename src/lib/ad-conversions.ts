// Per-tenant Google Ads conversion tracking for the public quote page.
//
// Opt-in only: a tenant with no entry below gets no script, no cookies and no
// network calls. Every function is best-effort and swallows its own errors, so
// tracking can never block or break a quote or booking.

type AdsConversionConfig = {
  /** Google Ads conversion ID, e.g. "AW-123456789". */
  adsId: string;
  /** Full send_to target, "AW-<id>/<label>". */
  sendTo: string;
  value: number;
  currency: string;
};

/** Keyed by tenant slug. Add a tenant here to enable tracking for them only. */
export const ADS_CONVERSIONS: Record<string, AdsConversionConfig> = {
  // Glocast - "Glocast - Website lead (booking or form submit)", account 969-219-8133.
  glocast: {
    adsId: "AW-11365020535",
    sendTo: "AW-11365020535/KetSCOT8qaAdEPfmoasq",
    value: 1.0,
    currency: "AUD",
  },
};

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function adsConversionFor(slug: string | null | undefined): AdsConversionConfig | null {
  if (!slug) return null;
  return Object.prototype.hasOwnProperty.call(ADS_CONVERSIONS, slug)
    ? (ADS_CONVERSIONS[slug] ?? null)
    : null;
}

/**
 * Loads gtag.js for the tenant's Google Ads ID (once per page). Called when the
 * quote page opens so the ad click (gclid) is recorded before the customer
 * finishes. No-op for tenants without a config.
 */
export function loadAdsTag(slug: string | null | undefined): void {
  try {
    const config = adsConversionFor(slug);
    if (!config || typeof window === "undefined" || typeof document === "undefined") return;
    const w = window as GtagWindow;
    if (!w.gtag) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function gtag() {
        // gtag.js expects the Arguments object itself, not an array.
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments);
      };
      w.gtag("js", new Date());
    }
    const marker = `data-bs-ads-${config.adsId}`;
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.adsId)}`;
    script.setAttribute(marker, "1");
    document.head.appendChild(script);
    w.gtag("config", config.adsId);
  } catch {
    // Tracking is never allowed to affect the page.
  }
}

/**
 * Fires the tenant's Google Ads conversion once for a successful enquiry or
 * booking. `dedupeKey` (conversation id or submission nonce) stops repeat
 * fires in the same browser session and is sent as transaction_id so Google
 * Ads also de-duplicates. No-op for tenants without a config.
 */
export function trackAdsConversion(slug: string | null | undefined, dedupeKey: string): void {
  try {
    const config = adsConversionFor(slug);
    if (!config || typeof window === "undefined" || !dedupeKey) return;
    const storageKey = `bookedsecure:ads-conv:${slug}:${dedupeKey}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Storage unavailable (private mode): still fire; transaction_id de-dupes.
    }
    loadAdsTag(slug);
    (window as GtagWindow).gtag?.("event", "conversion", {
      send_to: config.sendTo,
      value: config.value,
      currency: config.currency,
      transaction_id: dedupeKey,
    });
  } catch {
    // Tracking is never allowed to affect the page.
  }
}
