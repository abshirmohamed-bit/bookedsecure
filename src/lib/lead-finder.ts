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

export const LEAD_FINDER_MAX_RESULTS = 50;
/** Websites read per search (each read uses Firecrawl credits and time). */
export const LEAD_FINDER_MAX_READS = 20;
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
export function emailsOnPage(rawText: string, website: string | null): string[] {
  const host = hostOf(website);
  const text = rawText
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".");
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
  /** An email the listing itself publishes (OpenStreetMap). */
  email?: string | null;
  /** Only the name matches, so it ranks after real category matches. */
  weak?: boolean;
};

/** Directories, marketplaces, social networks, job and listing sites: never one business's own website. */
const NOT_A_BUSINESS_SITE = /(^|\.)(yellowpages|yelp|truelocal|hotfrog|oneflare|airtasker|hipages|serviceseeking|localsearch|startlocal|word-of-mouth|wordofmouth|productreview|tripadvisor|cylex-australia|cylex|trustpilot|facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|reddit|google|bing|apple|wikipedia|seek|indeed|glassdoor|gumtree|realestate|domain|fresha|timely|zomato|ubereats|doordash|menulog|booking|expedia|mapquest|waze|openstreetmap|whitepages|aussieweb|dlook|brownbook|infobel|nearbuy|hotdoc|healthengine|bark|thumbtack|houzz|finder|canstar|abr|asic|business|realcommercial|commercialrealestate|lease|commercialproperty2sell|propertyguru|onthehouse|allhomes|homely|rent|realestateview|clutch|crunchbase|zoominfo|ibisworld|dnb|kompass|manta|bizbuysell|seekbusiness)\.(com|com\.au|net|net\.au|org|org\.au|co|io|gov\.au)$/i;

/**
 * Sites that are real organisations but rarely what a local search wants:
 * commercial property and facility managers, councils and government,
 * hospitals and universities. For a security, cleaning, vending or facilities
 * business they are the customers, so they count whenever the request names
 * them ("property managers", "councils", "hospitals").
 */
const INSTITUTION_SITE = /(^|\.)(cbre|colliers|jll|knightfrank|savills|cushmanwakefield|ljhooker|raywhite|mcgrath|belle|harcourts|first|charterkc|vicinity|scentregroup|westfield|stockland|mirvac|dexus|gpt|charterhall|lendlease|goodman|centuria|isprop)\.(com|com\.au|net\.au)$|\.gov\.au$|\.edu\.au$|\.edu$/i;
const WANTS_INSTITUTIONS = /propert|facilit|strata|real estate|landlord|shopping cent|commercial|council|government|public sector|agenc|hospital|health service|universit|school|college|tafe|campus|education|department|retail cent|mall/i;

/**
 * `request` is the search, so institutions count when it asks for them; pass
 * `true` when the site comes from a map listing of that very organisation.
 */
export function isBusinessSite(url: string | null | undefined, request?: string | null | true): boolean {
  const host = hostOf(url);
  if (!host || NOT_A_BUSINESS_SITE.test(host)) return false;
  return !INSTITUTION_SITE.test(host) || request === true || WANTS_INSTITUTIONS.test(request ?? "");
}

/**
 * A web result that is a list, ranking, guide or article about businesses
 * rather than a business ("Car Detailers in Sydney: ranks 201 to 250",
 * "Top 10 security companies", "Car Care Resource Library").
 */
export function looksLikeArticle(title: string | null | undefined, url?: string | null): boolean {
  const t = (title ?? "").toLowerCase();
  if (/\b(top|best)\s+\d+\b|\b\d+\s+(best|top|great|leading)\b|\brank(s|ed|ing)?\s+\d+|\brankings?\b|\blist of\b|\bresource (library|centre|center|hub)\b|\bdirectory\b|\bcompare\b|\bvs\.?\s|\bhow to\b|\bwhat is\b|\bguide to\b|\bnear me\b.*\b(find|search)\b/.test(t)) return true;
  let path = "";
  try { path = url ? new URL(url).pathname.toLowerCase() : ""; } catch { path = ""; }
  return /\/(blog|news|articles?|guides?|insights|resources|lists?|rankings?|directory|tag|category)\//.test(`${path}/`);
}

/** Major centres to search when the area is a whole state or the country, biggest first. */
const STATE_CENTRES: Array<[RegExp, string[]]> = [
  [/^(nsw|new south wales)$/, ["Sydney NSW", "Newcastle NSW", "Wollongong NSW", "Central Coast NSW", "Parramatta NSW"]],
  [/^(vic|victoria)$/, ["Melbourne VIC", "Geelong VIC", "Ballarat VIC", "Bendigo VIC", "Dandenong VIC"]],
  [/^(qld|queensland)$/, ["Brisbane QLD", "Gold Coast QLD", "Sunshine Coast QLD", "Townsville QLD", "Cairns QLD"]],
  [/^(wa|western australia)$/, ["Perth WA", "Joondalup WA", "Fremantle WA", "Bunbury WA"]],
  [/^(sa|south australia)$/, ["Adelaide SA", "Mount Gambier SA", "Whyalla SA"]],
  [/^(tas|tasmania)$/, ["Hobart TAS", "Launceston TAS", "Devonport TAS"]],
  [/^(act|canberra region|australian capital territory)$/, ["Canberra ACT"]],
  [/^(nt|northern territory)$/, ["Darwin NT", "Alice Springs NT"]],
  [/^(australia|aus|au|nationwide|national|all of australia|across australia|australia wide|australia-wide|all states)$/, ["Sydney NSW", "Melbourne VIC", "Brisbane QLD", "Perth WA", "Adelaide SA", "Canberra ACT", "Gold Coast QLD", "Newcastle NSW", "Hobart TAS", "Darwin NT"]],
];

/**
 * The centres to fan out over when `where` is a state or all of Australia, or
 * null for a normal place. A state's middle is outback, so searching "NSW" as
 * one place finds nothing; its cities are where the businesses are.
 */
export function wideAreaCentres(where: string): string[] | null {
  const w = where.toLowerCase().replace(/^(all of|across|anywhere in|everywhere in|the whole of|whole of)\s+/, "").replace(/[.,]/g, "").trim();
  for (const [rx, centres] of STATE_CENTRES) if (rx.test(w)) return centres;
  return null;
}

/** Web search results to candidates: one per business website, directories dropped. */
export function candidatesFromWebSearch(results: Array<{ url?: string | null; title?: string | null; description?: string | null }>, request?: string | null): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of results) {
    if (!r.url || !isBusinessSite(r.url, request) || looksLikeArticle(r.title, r.url)) continue;
    const host = hostOf(r.url)!;
    if (seen.has(host)) continue;
    seen.add(host);
    const name = (r.title ?? host).split(/\s+[|\-–—:]\s+/)[0]!.trim().slice(0, 160) || host;
    out.push({ id: `web:${host}`, name, category: null, address: null, suburb: null, phone: null, website: `https://${host}`, rating: null, reviewCount: null, source: "web" });
  }
  return out;
}

const GENERIC_WORDS = new Set(["company", "companies", "business", "businesses", "services", "service", "local", "near", "best", "small", "large", "sydney", "australia", "with", "staff", "that", "have", "their", "and", "for", "the", "shop", "shops", "store", "stores", "supplier", "suppliers", "provider", "providers", "centre", "centres", "center", "centers", "agent", "agents", "agency", "agencies", "machine", "machines", "home", "homes", "firm", "firms", "contractor", "contractors", "specialist", "specialists"]);

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
  [/^(gym|fitnes|crossfit|pilate|yoga|martial)/, ["leisure=fitness_centre", "sport=martial_arts", "sport=yoga"]],
  [/^(pool|spa$)/, ["shop=swimming_pool", "craft=pool_installer"]],
  [/^(warehou|distribution|storage)/, ["building=warehouse", "industrial=warehouse", "industrial=logistics", "shop=storage_rental"]],
  [/^(logistic|freight|transport|courier|trucking)/, ["office=logistics", "industrial=logistics", "building=warehouse", "office=courier"]],
  [/^(factor|manufactur|plant$|work$|fabricat)/, ["man_made=works", "industrial=factory", "building=industrial", "building=manufacture"]],
  [/^(office|corporate|headquarter|compan$)/, ["office=company", "building=office", "office=consulting"]],
  [/^(construct|builder|civil|renovat)/, ["office=construction_company", "craft=builder", "craft=carpenter"]],
  [/^(plumb)/, ["craft=plumber"]],
  [/^(electric|sparky)/, ["craft=electrician"]],
  [/^(carpent|joiner|cabinet)/, ["craft=carpenter", "craft=joiner", "craft=cabinet_maker"]],
  [/^(roof)/, ["craft=roofer"]],
  [/^(paint)/, ["craft=painter", "shop=paint"]],
  [/^(tiler|tiling|floor)/, ["craft=tiler", "craft=floorer", "shop=flooring"]],
  [/^(plaster)/, ["craft=plasterer"]],
  [/^(glaz|glass)/, ["craft=glaziery", "shop=glaziery"]],
  [/^(hvac|aircon|air condition|heating|cooling)/, ["craft=hvac", "shop=hvac"]],
  [/^(solar)/, ["craft=photovoltaic", "office=energy_supplier", "shop=energy"]],
  [/^(locksmith)/, ["shop=locksmith", "craft=locksmith"]],
  [/^(landscap|garden|lawn|arborist|tree)/, ["craft=gardener", "shop=garden_centre", "office=landscape_architect"]],
  [/^(removal|mover$|moving)/, ["office=moving_company", "shop=storage_rental"]],
  [/^(welder|welding|metal|steel)/, ["craft=metal_construction", "craft=welder", "man_made=works"]],
  [/^(school|college)/, ["amenity=school", "amenity=college"]],
  [/^(tutor|coaching|learning)/, ["office=tutoring", "amenity=prep_school", "amenity=language_school"]],
  [/^(driving)/, ["amenity=driving_school", "office=driving_school"]],
  [/^(music)/, ["amenity=music_school", "shop=musical_instrument"]],
  [/^(dance)/, ["leisure=dance", "amenity=dancing_school"]],
  [/^(childcare|daycare|kindergarten|preschool|early)/, ["amenity=kindergarten", "amenity=childcare"]],
  [/^(dentist|dental|orthodont)/, ["amenity=dentist", "healthcare=dentist"]],
  [/^(physio)/, ["healthcare=physiotherapist"]],
  [/^(chiropract|osteo)/, ["healthcare=chiropractor", "healthcare=osteopathy"]],
  [/^(psycholog|counsel)/, ["healthcare=psychotherapist", "healthcare=counselling"]],
  [/^(optometr|optician)/, ["shop=optician", "healthcare=optometrist"]],
  [/^(pharmac|chemist)/, ["amenity=pharmacy"]],
  [/^(hospital|clinic|medical|doctor|gp$)/, ["amenity=clinic", "amenity=doctors", "amenity=hospital"]],
  [/^(vet$|veterinar)/, ["amenity=veterinary"]],
  [/^(pet|dog)/, ["shop=pet", "shop=pet_grooming", "amenity=animal_boarding"]],
  [/^(aged|nursing|retirement)/, ["amenity=nursing_home", "social_facility=nursing_home", "social_facility=group_home", "amenity=social_facility"]],
  [/^(hotel|motel|accommodation|hostel)/, ["tourism=hotel", "tourism=motel", "tourism=hostel", "tourism=guest_house"]],
  [/^(cafe|coffee)/, ["amenity=cafe"]],
  [/^(restaurant|dining)/, ["amenity=restaurant"]],
  [/^(takeaway|fast)/, ["amenity=fast_food"]],
  [/^(bar$|pub$|tavern|brewer)/, ["amenity=bar", "amenity=pub", "craft=brewery"]],
  [/^(bakery|baker|cake|patisser)/, ["shop=bakery", "shop=pastry", "shop=confectionery"]],
  [/^(butcher)/, ["shop=butcher"]],
  [/^(cater)/, ["craft=caterer", "office=catering"]],
  [/^(function|venue|reception|wedding|event)/, ["amenity=events_venue", "amenity=conference_centre", "shop=wedding"]],
  [/^(mechanic|car repair|auto|workshop|smash|panel)/, ["shop=car_repair", "craft=car_repair"]],
  [/^(tyre|tire)/, ["shop=tyres"]],
  [/^(car$|dealership|dealer|vehicle)/, ["shop=car", "shop=car_parts"]],
  [/^(detail|car wash)/, ["amenity=car_wash", "shop=car_repair"]],
  [/^(real estate|realestate|estate|realtor|propert)/, ["office=estate_agent", "office=property_management"]],
  [/^(accountant|accounting|bookkeep|tax)/, ["office=accountant", "office=tax_advisor"]],
  [/^(lawyer|solicitor|legal|conveyanc)/, ["office=lawyer", "office=notary"]],
  [/^(insur)/, ["office=insurance"]],
  [/^(mortgage|broker|finance|financial)/, ["office=financial", "office=financial_advisor", "amenity=bank"]],
  [/^(architect)/, ["office=architect"]],
  [/^(engineer)/, ["office=engineer"]],
  [/^(recruit|staffing|employment)/, ["office=employment_agency"]],
  [/^(software|technology|digital|marketing|agency)/, ["office=it", "office=company", "office=advertising_agency"]],
  [/^(print|signage|sign$)/, ["shop=copyshop", "craft=printer", "craft=signmaker"]],
  [/^(photograph|videograph)/, ["craft=photographer", "shop=photo"]],
  [/^(club|rsl)/, ["amenity=club", "club=sport", "leisure=sports_centre"]],
  [/^(salon|hairdress|barber|hair)/, ["shop=hairdresser"]],
  [/^(beauty|nail|lash|spa$|massage)/, ["shop=beauty", "shop=massage", "leisure=spa"]],
  [/^(florist|flower)/, ["shop=florist"]],
  [/^(jewel)/, ["shop=jewelry"]],
  [/^(cloth|fashion|boutique)/, ["shop=clothes", "shop=boutique"]],
  [/^(furniture)/, ["shop=furniture"]],
  [/^(hardware|trade supply)/, ["shop=hardware", "shop=doityourself", "shop=trade"]],
  [/^(laundr|dry clean)/, ["shop=laundry", "shop=dry_cleaning"]],
  [/^(supermarket|grocer)/, ["shop=supermarket", "shop=greengrocer", "shop=convenience"]],
  [/^(phone|mobile|computer|electronic|repair)/, ["shop=mobile_phone", "shop=computer", "shop=electronics", "craft=electronics_repair"]],
  [/^(church|mosque|temple|synagogue)/, ["amenity=place_of_worship"]],
  [/^(council|government)/, ["office=government"]],
  [/^(security|guard|patrol)/, ["office=security", "office=company", "shop=security"]],
  [/^(vending)/, ["amenity=vending_machine", "office=company"]],
  [/^(propert(y)? manag|facilit|strata|building manag)/, ["office=property_management", "office=estate_agent", "office=company"]],
  [/^(shopping|mall|retail cent)/, ["shop=mall", "amenity=marketplace"]],
  [/^(universit|tafe|campus)/, ["amenity=university", "amenity=college"]],
  [/^(data cent|datacent)/, ["building=data_center", "telecom=data_center"]],
  [/^(car park|carpark|parking operator)/, ["amenity=parking", "office=company"]],
  [/^(clean)/, ["office=cleaning", "craft=cleaning", "shop=dry_cleaning"]],
];

export function osmCategoryTags(keywords: string[]): string[] {
  const tags = new Set<string>();
  // Single words, and the whole phrase ("real estate agent").
  for (const k of [...keywords, keywords.join(" ")]) for (const [rx, list] of OSM_CATEGORY_TAGS) if (rx.test(k)) list.forEach((t) => tags.add(t));
  return [...tags].slice(0, 12);
}

/** OpenStreetMap keys a search plan may use (all describe what a place is). */
const OSM_KEYS = /^(shop|office|craft|amenity|leisure|industrial|healthcare|tourism|man_made|building|club|social_facility|sport)$/;

/** How to search for one request: web search phrases, OpenStreetMap categories and name words. */
export type SearchPlan = { webQueries: string[]; osmTags: string[]; nameWords: string[]; nearby?: string[] };

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
  const webQueries = list(r["webQueries"]).map((q) => q.replace(/[<>]/g, "").trim()).filter((q) => q.length >= 4).slice(0, 4).map((q) => q.slice(0, 200));
  const osmTags = [...new Set(list(r["osmTags"]).map((t) => t.trim().toLowerCase()).filter((t) => {
    const [k, val, extra] = t.split("=");
    return Boolean(k && val && extra === undefined && OSM_KEYS.test(k) && /^[a-z0-9_]{2,40}$/.test(val));
  }))].slice(0, 10);
  const nameWords = [...new Set(list(r["nameWords"]).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length >= 3))].slice(0, 4);
  if (!webQueries.length && !osmTags.length && !nameWords.length) return null;
  const nearby = [...new Set(list(r["nearby"]).map((n) => n.replace(/[<>]/g, "").trim()).filter((n) => n.length >= 3))].slice(0, 5).map((n) => n.slice(0, 40));
  return nearby.length ? { webQueries, osmTags, nameWords, nearby } : { webQueries, osmTags, nameWords };
}

/** Overpass query: exact category tags (fast) plus one name match, inside a box (south, west, north, east). */
export function overpassQuery(keywords: string[], box: [number, number, number, number], limit = 60, plan?: SearchPlan | null, mode: "all" | "tags" | "names" = "all"): string {
  const rx = keywords.map((k) => k.replace(/[^a-z]/g, "")).filter(Boolean).join("|");
  const b = box.map((n) => n.toFixed(4)).join(",");
  // A plan for this exact request beats the built-in word list (which is broader).
  const tags = (plan?.osmTags.length ? plan.osmTags : osmCategoryTags(keywords)).slice(0, 14);
  const byTag = tags.map((t) => { const [k, v] = t.split("="); return `nwr["${k}"="${v}"]["name"](${b});`; }).join("");
  if (mode === "names") {
    const words = [...new Set([...(plan?.nameWords ?? []), ...keywords])].map((k) => k.replace(/[^a-z]/g, "")).filter((k) => k.length >= 3).slice(0, 6).join("|");
    return `[out:json][timeout:40];(nwr["name"~"${words || rx}",i](${b}););out center tags ${limit};`;
  }
  // A name pattern is slow on the public servers, so in "all" mode it's only used for words with no known category.
  const unmapped = mode === "tags" ? "" : [...new Set([...(plan?.nameWords ?? []), ...keywords.filter((k) => osmCategoryTags([k]).length === 0 && !(plan?.osmTags.length))])]
    .map((k) => k.replace(/[^a-z]/g, "")).filter(Boolean).slice(0, 4).join("|");
  const byName = unmapped ? `nwr["name"~"${unmapped}",i](${b});` : "";
  return `[out:json][timeout:40];(${byTag}${byName}${mode !== "tags" && !byTag && !byName && rx ? `nwr["name"~"${rx}",i](${b});` : ""});out center tags ${limit};`;
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
  if (name.split(/\s+/).length === 1 && (Object.values(t).some((v) => v !== name && v.toLowerCase() === name.toLowerCase()) || keywords.some((k) => name.toLowerCase().startsWith(k)))) return null;
  const kind = t["shop"] ?? t["office"] ?? t["craft"] ?? t["industrial"] ?? t["leisure"] ?? t["amenity"] ?? t["healthcare"] ?? t["tourism"] ?? (t["man_made"] === "works" ? "works" : null) ?? (t["building"] && t["building"] !== "yes" ? t["building"] : null);
  // A named place with no category still counts if it shows signs of being a business.
  const looksLikeBusiness = Boolean(t["website"] || t["contact:website"] || t["phone"] || t["contact:phone"] || t["email"] || t["contact:email"] || t["brand"] || t["operator"] || t["addr:street"]);
  if (kind ? NOT_A_BUSINESS_VALUE.test(kind) : !looksLikeBusiness) return null;
  // Places that only match by name rank after real category matches, but are still returned.
  let weak = false;
  if (planTags.length || planNames.length) {
    const tagMatch = Object.entries(t).some(([k, v]) => planTags.includes(`${k}=${v}`));
    const nameMatch = planNames.some((w) => name.toLowerCase().includes(w));
    if (!tagMatch && !nameMatch) weak = true;
    else if (!tagMatch && t["shop"]) weak = true;
  } else if (keywords.length && t["shop"]) {
    const wanted = new Set(osmCategoryTags(keywords));
    const tagMatch = Object.entries(t).some(([k, v]) => wanted.has(`${k}=${v}`));
    const valueMatch = keywords.some((k) => Object.entries(t).some(([key, v]) => key !== "name" && !key.startsWith("name:") && v.toLowerCase().includes(k)));
    if (!tagMatch && !valueMatch) weak = true;
  }
  const website = t["website"] ?? t["contact:website"] ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const suburb = t["addr:suburb"] ?? t["addr:city"] ?? null;
  const address = [street, suburb, t["addr:postcode"]].filter(Boolean).join(", ") || null;
  return {
    id: `osm:${el.type}/${el.id}`,
    name: name.slice(0, 160),
    category: kind ? kind.replace(/_/g, " ").slice(0, 80) : null,
    address,
    suburb: suburb?.slice(0, 60) ?? null,
    phone: (t["phone"] ?? t["contact:phone"] ?? null)?.slice(0, 30) ?? null,
    website: website && isBusinessSite(website, true) ? website.slice(0, 300) : null,
    rating: null,
    reviewCount: null,
    source: "osm",
    email: (t["email"] ?? t["contact:email"] ?? null)?.toLowerCase().slice(0, 120) ?? null,
    weak,
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
  const ordered = lists.map((l) => [...l].sort((a, b) => Number(Boolean(a.weak)) - Number(Boolean(b.weak))));
  for (let i = 0; i < longest; i++) for (const list of ordered) if (list[i] && !list[i]!.weak) turns.push(list[i]!);
  for (let i = 0; i < longest; i++) for (const list of ordered) if (list[i]?.weak) turns.push(list[i]!);
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

// ----- Co-Work suggestions -----

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

/** Plain web phrases that work for any kind of business; used alongside (or instead of) the AI's. */
export function webFallbackQueries(what: string, where: string): string[] {
  const w = what.trim();
  const place = where.trim();
  return [`${w} ${place}`, `${w} near ${place} contact us`, `best ${w} in ${place} Australia`];
}

/** On a business's site: the links most likely to hold its email. */
export function contactLinks(links: unknown, website: string): string[] {
  const host = hostOf(website);
  const origin = (() => { try { return new URL(website).origin; } catch { return null; } })();
  const found = (Array.isArray(links) ? links : [])
    .filter((l): l is string => typeof l === "string" && hostOf(l) === host && /contact|get-in-touch|enquir|about/i.test(l))
    .sort((a, b) => Number(/about/i.test(a)) - Number(/about/i.test(b)));
  const guesses = origin ? [`${origin}/contact`, `${origin}/contact-us`] : [];
  return [...new Set([...found, ...guesses])].slice(0, 2);
}

/** Whether a web result really is this named business's website (shares a distinctive word with the name). */
export function siteMatchesName(name: string, url: string, title?: string | null, area?: string | null): boolean {
  const generic = new Set(["the", "and", "pty", "ltd", "limited", "group", "services", "service", "australia", "sydney", "company", "centre", "center", "shop", "store"]);
  // The suburb is in many other businesses' names too, so it doesn't count as a match.
  const place = new Set((area ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/));
  const words = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !generic.has(w) && !place.has(w));
  if (words.length === 0) return false;
  const host = (hostOf(url) ?? "").replace(/[^a-z0-9]/g, "");
  const heading = (title ?? "").toLowerCase();
  const hits = words.filter((w) => host.includes(w) || heading.includes(w)).length;
  return hits >= Math.min(2, words.length);
}

/** A second-tier search area when a suburb is thin: the same centre, about 10-15 km around. */
export function widerBox(box: [number, number, number, number]): [number, number, number, number] {
  const [s, w, n, e] = box;
  const pad = 0.1;
  return [s - pad, w - pad, n + pad, e + pad];
}

/** A Photon (free OpenStreetMap geocoder) result in the same shape as an Overpass element. */
export function photonToElement(feature: { properties?: Record<string, unknown> }): { type: string; id: number; tags: Record<string, string> } | null {
  const p = feature.properties ?? {};
  const id = typeof p["osm_id"] === "number" ? (p["osm_id"] as number) : null;
  const key = typeof p["osm_key"] === "string" ? (p["osm_key"] as string) : null;
  const value = typeof p["osm_value"] === "string" ? (p["osm_value"] as string) : null;
  const name = typeof p["name"] === "string" ? (p["name"] as string) : null;
  if (!id || !key || !value || !name) return null;
  const type = p["osm_type"] === "W" ? "way" : p["osm_type"] === "R" ? "relation" : "node";
  const tags: Record<string, string> = { name, [key]: value };
  const copy = (from: string, to: string) => { if (typeof p[from] === "string") tags[to] = p[from] as string; };
  copy("street", "addr:street");
  copy("housenumber", "addr:housenumber");
  copy("city", "addr:city");
  copy("district", "addr:suburb");
  copy("postcode", "addr:postcode");
  return { type, id, tags };
}
