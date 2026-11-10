/**
 * Lead finder: pure rules. A business describes who it wants to reach
 * ("cleaning companies in Parramatta with 10+ staff"); BookedSecure finds
 * matching businesses (Google Places), reads each one's own website, checks it
 * against the request, and keeps only email addresses the business publishes
 * itself, checked before use. Found businesses can be added to customers and
 * reached through the existing email campaigns (unsubscribe included).
 * Australian Spam Act: only publicly published business addresses, only about
 * their work, always with an unsubscribe. Nothing is sent from here.
 */

export const LEAD_FINDER_MAX_RESULTS = 20;
/** Searches a business can run each month (keeps Google, Firecrawl and checking costs bounded). */
export const LEAD_FINDER_MONTHLY_SEARCHES = 20;
export const LEAD_FINDER_SOURCE = "Lead finder";

export type ProspectFit = "good" | "maybe" | "no" | "unknown";
export type EmailStatus = "none" | "unverified" | "valid" | "risky" | "invalid";

export function searchProblem(input: { what: string; where: string; criteria?: string | null }): string | null {
  if (input.what.trim().length < 3) return "Say what kind of business you're looking for, for example cleaning companies.";
  if (input.where.trim().length < 2) return "Say where, for example Parramatta or Western Sydney.";
  if (/[<>]/.test(input.what + input.where + (input.criteria ?? ""))) return "Please remove < and > from the search.";
  return null;
}

export const placesQuery = (what: string, where: string) => `${what.trim()} in ${where.trim()}`.slice(0, 200);

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Addresses that are never a person to email: images, placeholders, platform and tracking addresses. */
const NOT_A_CONTACT = /\.(png|jpe?g|gif|webp|svg)$|^(no-?reply|do-?not-?reply|example|test|user|email|name|your(name|email)?)@|@(example\.|sentry|wixpress|godaddy|domain\.|email\.com$|yourdomain|squarespace|shopify)/i;

/** Emails published on the page, preferring ones on the business's own domain, then role inboxes. */
export function emailsOnPage(text: string, website: string | null): string[] {
  const host = hostOf(website);
  const found = [...new Set((text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase().replace(/^mailto:/, "").replace(/[.,;:]+$/, "")))]
    .filter((e) => !NOT_A_CONTACT.test(e) && e.length <= 120);
  const score = (e: string) => {
    const domain = e.split("@")[1] ?? "";
    let s = 0;
    if (host && (domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`))) s += 10;
    if (/^(info|hello|contact|enquir|admin|office|sales|bookings?|accounts)/.test(e)) s += 3;
    return s;
  };
  return found.sort((a, b) => score(b) - score(a)).slice(0, 3);
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** The suburb from a Google formatted address ("12 Smith St, Auburn NSW 2144, Australia" -> "Auburn"). */
export function suburbFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const part = address.split(",").map((p) => p.trim()).find((p) => /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/.test(p));
  const suburb = part?.replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b.*$/, "").trim();
  return suburb && suburb.length > 1 ? suburb.slice(0, 60) : null;
}

/** ZeroBounce result to our status. Catch-all and unknown are risky, never "valid". */
export function emailStatusFromZeroBounce(status: string | null | undefined): EmailStatus {
  switch ((status ?? "").toLowerCase()) {
    case "valid": return "valid";
    case "catch-all": case "unknown": return "risky";
    case "invalid": case "spamtrap": case "abuse": case "do_not_mail": return "invalid";
    default: return "unverified";
  }
}

export function readFit(value: unknown): ProspectFit {
  return value === "good" || value === "maybe" || value === "no" ? value : "unknown";
}

/** Whether a found business can be emailed by a campaign. */
export const emailable = (status: EmailStatus) => status === "valid" || status === "unverified" || status === "risky";
