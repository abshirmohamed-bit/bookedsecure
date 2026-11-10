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

// ----- Free discovery: Firecrawl web search and OpenStreetMap -----

/** A business found by any source, before its website is read. */
export type Candidate = {
  /** Stable id per source: "web:<host>", "osm:node/123" or a Google place id. */
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  suburb: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: "web" | "osm" | "google";
};

/** Directories, marketplaces, social networks and government sites: never the business's own website. */
const NOT_A_BUSINESS_SITE = /(^|\.)(yellowpages|yelp|truelocal|hotfrog|oneflare|airtasker|hipages|serviceseeking|localsearch|startlocal|word-of-mouth|wordofmouth|productreview|tripadvisor|cylex-australia|cylex|trustpilot|facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|reddit|google|bing|apple|wikipedia|seek|indeed|glassdoor|gumtree|realestate|domain|fresha|timely|zomato|ubereats|doordash|menulog|booking|expedia|mapquest|waze|openstreetmap|whitepages|aussieweb|dlook|brownbook|infobel|nearbuy|hotdoc|healthengine|bark|thumbtack|houzz|finder|canstar|abr|asic|business|realcommercial|commercialrealestate|lease|commercialproperty2sell|propertyguru|onthehouse|allhomes|homely|rent|realestateview|cbre|colliers|jll|knightfrank|savills|cushmanwakefield)\.(com|com\.au|net|net\.au|org|org\.au|co|io|gov\.au)$|\.gov\.au$|\.edu\.au$/i;

export function isBusinessSite(url: string | null | undefined): boolean {
  const host = hostOf(url);
  return Boolean(host) && !NOT_A_BUSINESS_SITE.test(host!);
}

/** Web search results to candidates: one per business website, directories dropped. */
export function candidatesFromWebSearch(results: Array<{ url?: string | null; title?: string | null; description?: string | null }>): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of results) {
    if (!r.url || !isBusinessSite(r.url)) continue;
    const host = hostOf(r.url)!;
    if (seen.has(host)) continue;
    seen.add(host);
    const name = (r.title ?? host).split(/\s+[|\-–—:]\s+/)[0]!.trim().slice(0, 160) || host;
    out.push({ id: `web:${host}`, name, category: null, address: null, suburb: null, phone: null, website: `https://${host}`, rating: null, reviewCount: null, source: "web" });
  }
  return out;
}

const GENERIC_WORDS = new Set(["company", "companies", "business", "businesses", "services", "service", "local", "near", "best", "small", "large", "sydney", "australia", "with", "staff", "that", "have", "their", "and", "for", "the"]);

/** Words to look for in OpenStreetMap names and categories ("warehouses, gyms and factories" -> warehouse, gym, factor). */
export function osmKeywords(what: string): string[] {
  const words = what.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(ses|xes|ches|shes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, "$1"))
    .map((w) => (w.endsWith("y") && w.length > 4 ? w.slice(0, -1) : w));
  return [...new Set(words)].slice(0, 6);
}

/**
 * How OpenStreetMap files common kinds of business (it says "fitness_centre",
 * people say "gym"). Keyword stem -> exact key=value tags; generic, never tenant-specific.
 */
const OSM_CATEGORY_TAGS: Array<[RegExp, string[]]> = [
  [/^(gym|fitnes|crossfit|pilate|yoga)/, ["leisure=fitness_centre", "leisure=sports_centre"]],
  [/^(warehou|distribution|storage)/, ["building=warehouse", "industrial=warehouse", "industrial=logistics"]],
  [/^(logistic|freight|transport|courier)/, ["office=logistics", "industrial=logistics", "building=warehouse"]],
  [/^(factor|manufactur|plant|work$)/, ["man_made=works", "industrial=factory", "building=industrial"]],
  [/^(office|corporate|headquarter)/, ["office=company", "building=office"]],
  [/^(construct|builder|building)/, ["office=construction_company", "craft=builder"]],
  [/^(school|college)/, ["amenity=school", "amenity=college"]],
  [/^(childcare|daycare|kindergarten|preschool)/, ["amenity=kindergarten", "amenity=childcare"]],
  [/^(dentist|dental|orthodont)/, ["amenity=dentist", "healthcare=dentist"]],
  [/^(physio)/, ["healthcare=physiotherapist"]],
  [/^(hospital|clinic|medical|doctor|gp$)/, ["amenity=clinic", "amenity=doctors"]],
  [/^(aged|nursing|retirement)/, ["amenity=nursing_home", "social_facility=nursing_home"]],
  [/^(hotel|motel|accommodation)/, ["tourism=hotel", "tourism=motel"]],
  [/^(cafe|coffee)/, ["amenity=cafe"]],
  [/^(restaurant)/, ["amenity=restaurant"]],
  [/^(mechanic|car repair|auto|workshop|smash|panel)/, ["shop=car_repair", "craft=car_repair"]],
  [/^(real estate|estate agent|realestate|realtor)/, ["office=estate_agent"]],
  [/^(accountant|accounting|bookkeep)/, ["office=accountant"]],
  [/^(lawyer|solicitor|legal)/, ["office=lawyer"]],
  [/^(club|rsl)/, ["amenity=club", "club=sport"]],
  [/^(salon|hairdress|barber|beauty)/, ["shop=hairdresser", "shop=beauty"]],
  [/^(supermarket|grocer)/, ["shop=supermarket"]],
  [/^(church|mosque|temple)/, ["amenity=place_of_worship"]],
  [/^(council|government)/, ["office=government"]],
  [/^(security)/, ["office=security"]],
  [/^(clean)/, ["office=cleaning", "craft=cleaning"]],
];

export function osmCategoryTags(keywords: string[]): string[] {
  const tags = new Set<string>();
  for (const k of keywords) for (const [rx, list] of OSM_CATEGORY_TAGS) if (rx.test(k)) list.forEach((t) => tags.add(t));
  return [...tags].slice(0, 12);
}

/** OpenStreetMap keys a search plan may use (all describe what a place is). */
const OSM_KEYS = /^(shop|office|craft|amenity|leisure|industrial|healthcare|tourism|man_made|building|club|social_facility|sport)$/;

/** How to search for one request: web search phrases, OpenStreetMap categories and name words. */
export type SearchPlan = { webQueries: string[]; osmTags: string[]; nameWords: string[] };

/** Reads the AI's search plan, keeping only safe, well-formed parts. */
export function readSearchPlan(raw: string): SearchPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let v: unknown;
  try { v = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  const webQueries = list(r["webQueries"]).map((q) => q.replace(/[<>]/g, "").trim()).filter((q) => q.length >= 4).slice(0, 2).map((q) => q.slice(0, 200));
  const osmTags = [...new Set(list(r["osmTags"]).map((t) => t.trim().toLowerCase()).filter((t) => {
    const [k, val, extra] = t.split("=");
    return Boolean(k && val && extra === undefined && OSM_KEYS.test(k) && /^[a-z0-9_]{2,40}$/.test(val));
  }))].slice(0, 10);
  const nameWords = [...new Set(list(r["nameWords"]).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length >= 3))].slice(0, 4);
  if (!webQueries.length && !osmTags.length && !nameWords.length) return null;
  return { webQueries, osmTags, nameWords };
}

/** Overpass query: exact category tags (fast) plus one name match, inside a box (south, west, north, east). */
export function overpassQuery(keywords: string[], box: [number, number, number, number], limit = 60, plan?: SearchPlan | null): string {
  const rx = keywords.map((k) => k.replace(/[^a-z]/g, "")).filter(Boolean).join("|");
  const b = box.map((n) => n.toFixed(4)).join(",");
  // A plan for this exact request beats the built-in word list (which is broader).
  const tags = (plan?.osmTags.length ? plan.osmTags : osmCategoryTags(keywords)).slice(0, 14);
  const byTag = tags.map((t) => { const [k, v] = t.split("="); return `nwr["${k}"="${v}"]["name"](${b});`; }).join("");
  // A name pattern is slow on the public servers, so it's only used for words with no known category.
  const unmapped = [...new Set([...(plan?.nameWords ?? []), ...keywords.filter((k) => osmCategoryTags([k]).length === 0 && !(plan?.osmTags.length))])]
    .map((k) => k.replace(/[^a-z]/g, "")).filter(Boolean).slice(0, 4).join("|");
  const byName = unmapped ? `nwr["name"~"${unmapped}",i](${b});` : "";
  return `[out:json][timeout:40];(${byTag}${byName}${!byTag && !byName && rx ? `nwr["name"~"${rx}",i](${b});` : ""});out center tags ${limit};`;
}

const NOT_A_PLACE_OF_BUSINESS = ["railway", "highway", "public_transport", "route", "boundary", "natural", "waterway", "power"];
const NOT_A_BUSINESS_VALUE = /^(fitness_station|park|playground|pitch|bench|parking|toilets|bus_station|shelter|depot|intermodal_freight_terminal)$/;

/**
 * One OpenStreetMap element to a candidate, or null when it isn't a business.
 * With keywords, a shop that only has the word in its name ("Chemist Warehouse"
 * for warehouses) is skipped: its category says it's something else.
 */
export function candidateFromOsm(el: { type?: string; id?: number; tags?: Record<string, string> }, keywords: string[] = [], planTags: string[] = [], planNames: string[] = []): Candidate | null {
  const t = el.tags ?? {};
  const name = t["name"]?.trim();
  if (!name || !el.type || !el.id) return null;
  if (NOT_A_PLACE_OF_BUSINESS.some((k) => k in t)) return null;
  const kind = t["shop"] ?? t["office"] ?? t["craft"] ?? t["industrial"] ?? t["leisure"] ?? t["amenity"] ?? t["healthcare"] ?? t["tourism"] ?? (t["man_made"] === "works" ? "works" : null) ?? (t["building"] && t["building"] !== "yes" ? t["building"] : null);
  if (!kind || NOT_A_BUSINESS_VALUE.test(kind)) return null;
  // With a plan, a place must be one of the planned categories or carry a planned name word.
  if (planTags.length || planNames.length) {
    const tagMatch = Object.entries(t).some(([k, v]) => planTags.includes(`${k}=${v}`));
    const nameMatch = planNames.some((w) => name.toLowerCase().includes(w));
    if (!tagMatch && !nameMatch) return null;
  } else if (keywords.length && t["shop"]) {
    const wanted = new Set(osmCategoryTags(keywords));
    const tagMatch = Object.entries(t).some(([k, v]) => wanted.has(`${k}=${v}`));
    const valueMatch = keywords.some((k) => Object.entries(t).some(([key, v]) => key !== "name" && !key.startsWith("name:") && v.toLowerCase().includes(k)));
    if (!tagMatch && !valueMatch) return null;
  }
  const website = t["website"] ?? t["contact:website"] ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const suburb = t["addr:suburb"] ?? t["addr:city"] ?? null;
  const address = [street, suburb, t["addr:postcode"]].filter(Boolean).join(", ") || null;
  return {
    id: `osm:${el.type}/${el.id}`,
    name: name.slice(0, 160),
    category: kind.replace(/_/g, " ").slice(0, 80),
    address,
    suburb: suburb?.slice(0, 60) ?? null,
    phone: (t["phone"] ?? t["contact:phone"] ?? null)?.slice(0, 30) ?? null,
    website: website && isBusinessSite(website) ? website.slice(0, 300) : null,
    rating: null,
    reviewCount: null,
    source: "osm",
  };
}

/**
 * Joins sources, one entry per website (or per name when there's none). The
 * sources take turns, so web results don't crowd out the map's local businesses.
 */
export function mergeCandidates(lists: Candidate[][], limit: number): Candidate[] {
  const out: Candidate[] = [];
  const keys = new Set<string>();
  const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  const turns: Candidate[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) turns.push(list[i]!);
  for (const c of turns) {
    const host = hostOf(c.website);
    const k1 = host ? `h:${host}` : null;
    const k2 = `n:${nameKey(c.name)}`;
    if ((k1 && keys.has(k1)) || keys.has(k2)) continue;
    if (k1) keys.add(k1);
    keys.add(k2);
    out.push(c);
  }
  return out.slice(0, limit);
}

/** Web search wording that finds businesses of that type, not property listings or job ads. */
export function webSearchQuery(what: string, where: string): string {
  return `${what.trim()} business in ${where.trim()} Australia -lease -"for sale" -"for rent" -jobs`.slice(0, 220);
}

// ----- Co-work suggestions -----

export type SearchSuggestion = { what: string; where: string; criteria: string | null; why: string | null };

/** Reads the AI's JSON list of searches, keeping only usable ones (up to 4). */
export function readSuggestions(raw: string): SearchSuggestion[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let list: unknown;
  try { list = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && !/[<>]/.test(v) ? v.trim().slice(0, max) : null);
  const out: SearchSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const what = text(r["what"], 120);
    const where = text(r["where"], 80);
    if (!what || what.length < 3 || !where || where.length < 2) continue;
    out.push({ what, where, criteria: text(r["criteria"], 400), why: text(r["why"], 200) });
    if (out.length >= 4) break;
  }
  return out;
}
