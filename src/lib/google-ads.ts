/**
 * Google Ads: the pure parts shared by the server and the tests.
 *
 * Spend, clicks, impressions and conversions come from the Google Ads API
 * (read only, per campaign per day). Leads, bookings and revenue come from
 * BookedSecure's own records: a lead is from Google Ads when the quote-page
 * visit that became it carried a Google ad click (gclid) or was tagged as
 * paid Google traffic.
 */

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_CALLBACK_PATH = "/api/public/google-ads/oauth/callback";
/** Google retires API versions about a year after release; GOOGLE_ADS_API_VERSION overrides this. */
export const DEFAULT_GOOGLE_ADS_API_VERSION = "v23";

export function buildGoogleAdsAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_ADS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** "123-456-7890" or "1234567890" → "1234567890"; anything else → null. */
export function normaliseCustomerId(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/[\s-]/g, "");
  return /^\d{6,12}$/.test(digits) ? digits : null;
}

/** "1234567890" → "123-456-7890", the way Google Ads shows it. */
export function formatCustomerId(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The campaign-by-day query. Dates are validated, never taken from input text. */
export function campaignDailyQuery(since: string, until: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Bad date range.");
  return "SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions "
    + `FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
}

export type GoogleSearchRow = {
  campaign?: { id?: string | number; name?: string };
  segments?: { date?: string };
  metrics?: { costMicros?: string | number; clicks?: string | number; impressions?: string | number; conversions?: string | number };
};

export type GoogleSpendRow = { campaign_id: string; campaign_name: string | null; date: string; spend: number; clicks: number; impressions: number; conversions: number };

/** One API result row as a spend row (cost is in millionths of the account currency). */
export function toSpendRow(r: GoogleSearchRow): GoogleSpendRow | null {
  const id = r.campaign?.id;
  const date = r.segments?.date;
  if (id === undefined || id === null || !date) return null;
  const num = (v: unknown) => Number(v) || 0;
  return {
    campaign_id: String(id), campaign_name: r.campaign?.name ?? null, date,
    spend: Math.round(num(r.metrics?.costMicros) / 10_000) / 100,
    clicks: Math.round(num(r.metrics?.clicks)), impressions: Math.round(num(r.metrics?.impressions)),
    conversions: Math.round(num(r.metrics?.conversions) * 100) / 100,
  };
}

export type QuoteVisit = { conversation_id: string | null; source: string | null; medium: string | null; campaign: string | null; utm: unknown };

/** Whether a quote-page visit came from a Google ad: an ad click id, or paid Google traffic. */
export function isGoogleAdVisit(v: Pick<QuoteVisit, "source" | "medium" | "utm">): boolean {
  const utm = (v.utm && typeof v.utm === "object" ? v.utm : {}) as Record<string, unknown>;
  if (typeof utm["gclid"] === "string" && utm["gclid"]) return true;
  if (typeof utm["gbraid"] === "string" || typeof utm["wbraid"] === "string") return true;
  const source = (v.source ?? "").toLowerCase();
  const medium = (v.medium ?? "").toLowerCase();
  return /(^|\.)google(\.|$)|^adwords$|^google_ads$/.test(source) && /^(cpc|ppc|paid|paidsearch|paid_search|display|sem)$/.test(medium);
}

/**
 * The campaign a Google lead belongs to: the utm_campaign it carried, matched
 * to a campaign's id or name (case-insensitive). Unmatched leads still count,
 * under "Not from a known campaign".
 */
export function matchCampaign(campaign: string | null, known: Array<{ id: string; name: string | null }>): { id: string | null; name: string | null } {
  const value = (campaign ?? "").trim().toLowerCase();
  if (!value) return { id: null, name: null };
  const hit = known.find((k) => k.id === value || (k.name ?? "").trim().toLowerCase() === value);
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: null };
}
