/**
 * Website-based tenant onboarding: pure normalisation layer.
 *
 * Reads what a tenant's own public website says about their business and turns
 * it into a *proposal* the owner reviews before anything is saved. Nothing here
 * performs I/O, and nothing here invents a fact: every value either comes from
 * the tenant's site or is left empty.
 *
 * Tenant-neutral by construction — no business name, service, price or suburb
 * is ever hardcoded.
 */

import type { AvailabilityWindow } from "@/lib/availability";

export const MAX_PROPOSED_SERVICES = 20;
export const DEFAULT_SERVICE_DURATION_MINUTES = 60;

export type ScrapedService = {
  name?: string | null;
  price?: string | null;
  description?: string | null;
  durationMinutes?: number | null;
};

export type ScrapedAddon = {
  name?: string | null;
  price?: string | null;
  description?: string | null;
  durationMinutes?: number | null;
  /** Service names the site says this extra goes with. Empty means "any". */
  appliesTo?: string[] | null;
};

/** Raw, untrusted shape read from the tenant's website. */
export type ScrapedSite = {
  businessName?: string | null;
  suburb?: string | null;
  serviceArea?: string | null;
  phone?: string | null;
  openingHours?: string | null;
  logoUrl?: string | null;
  services?: ScrapedService[] | null;
  addons?: ScrapedAddon[] | null;
};

export type ProposedService = {
  name: string;
  description: string | null;
  price_guidance: string | null;
  duration_minutes: number;
  /** True when the tenant already has this service, so it will be left alone. */
  alreadyHave: boolean;
};

export type ProposedAddon = {
  name: string;
  description: string | null;
  price_guidance: string | null;
  duration_minutes: number | null;
  /** Names of the tenant's services this extra will be offered with. */
  serviceNames: string[];
  /** True when the tenant already has an extra with this name. */
  alreadyHave: boolean;
};

export type OnboardingProposal = {
  sourceUrl: string;
  business: {
    name: string | null;
    service_area: string | null;
    opening_hours: string | null;
    phone_number: string | null;
  };
  logoUrl: string | null;
  services: ProposedService[];
  addons: ProposedAddon[];
  weeklyWindows: AvailabilityWindow[];
  /** Plain-language notes for the owner about anything the site did not say. */
  warnings: string[];
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Accepts what a person would type ("glocast.com.au") and returns a URL. */
export function normaliseSiteUrl(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
  url.hash = "";
  return url.toString();
}

/**
 * Australian contact number in E.164, accepting mobiles and landlines as they
 * are written on websites. Returns null when it cannot be trusted.
 */
export function normaliseAuContactNumber(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const bare = digits.startsWith("+") ? digits.slice(1) : digits;
  if (/^61[2-9]\d{8}$/.test(bare)) return `+${bare}`;
  if (/^0[2-9]\d{8}$/.test(bare)) return `+61${bare.slice(1)}`;
  if (/^13\d{4}$/.test(bare) || /^1[38]00\d{6}$/.test(bare)) return bare;
  return null;
}

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseClock(raw: string, meridiemHint: string | null): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = (match[3] ?? meridiemHint ?? "").toLowerCase();
  if (!Number.isInteger(hour) || hour > 24 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 24) return null;
  if (hour === 24) return "23:59";
  return `${pad(hour)}:${pad(minute)}`;
}

function daysFromToken(segment: string): number[] {
  const lower = segment.toLowerCase();
  const days = new Set<number>();
  if (/\bevery ?day\b|\bdaily\b|\b7[\s-]*days?\b|\ball week\b|\bseven days\b/.test(lower)) {
    for (let day = 0; day < 7; day++) days.add(day);
    return [...days];
  }
  if (/\bweekdays?\b/.test(lower)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(lower)) return [0, 6];

  const dayPattern = /([a-z]{3,9})\s*(?:-|–|—|to)\s*([a-z]{3,9})|([a-z]{3,9})/g;
  let match: RegExpExecArray | null;
  while ((match = dayPattern.exec(lower))) {
    const [, fromRaw, toRaw, singleRaw] = match;
    if (fromRaw && toRaw && fromRaw in DAY_INDEX && toRaw in DAY_INDEX) {
      const from = DAY_INDEX[fromRaw]!;
      const to = DAY_INDEX[toRaw]!;
      for (let step = 0; step < 7; step++) {
        const day = (from + step) % 7;
        days.add(day);
        if (day === to) break;
      }
      continue;
    }
    if (singleRaw && singleRaw in DAY_INDEX) days.add(DAY_INDEX[singleRaw]!);
  }
  return [...days];
}

/**
 * Turns published opening-hours text into bookable weekly windows.
 * Anything ambiguous is dropped rather than guessed.
 */
export function parseOpeningHours(input: string | null | undefined): AvailabilityWindow[] {
  if (typeof input !== "string" || !input.trim()) return [];
  const windows: AvailabilityWindow[] = [];
  const seen = new Set<string>();
  // "7am-6pm | 7 days a week" splits into a time-only part and a day-only part,
  // so a day statement anywhere in the text can stand in for a missing one.
  const fallbackDays = daysFromToken(input);

  for (const segment of input.split(/[\n;,|•]+/)) {
    const chunk = segment.trim();
    if (!chunk) continue;
    if (/closed/i.test(chunk)) continue;
    const days = daysFromToken(chunk);
    const effectiveDays = days.length > 0 ? days : fallbackDays;
    if (effectiveDays.length === 0) continue;

    const timeMatch =
      /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(
        chunk,
      );
    if (!timeMatch) continue;
    const endHasMeridiem = /am|pm/i.test(timeMatch[2]!);
    const start = parseClock(timeMatch[1]!, endHasMeridiem ? null : "am");
    const end = parseClock(timeMatch[2]!, endHasMeridiem ? null : "pm");
    if (!start || !end || end <= start) continue;

    for (const weekday of effectiveDays) {
      const key = `${weekday}-${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      windows.push({ weekday, start, end });
    }
  }

  return windows.sort((a, b) => (a.weekday === b.weekday ? a.start.localeCompare(b.start) : a.weekday - b.weekday));
}

/**
 * Words that carry no meaning when telling two service names apart, so
 * "Full Detail (Interior & Exterior)" and "Full Detail Interior + Exterior"
 * are recognised as the same service instead of being added twice.
 */
const SERVICE_FILLER_WORDS = new Set([
  "a",
  "and",
  "complete",
  "detail",
  "detailing",
  "for",
  "full",
  "our",
  "package",
  "plus",
  "service",
  "services",
  "the",
  "treatment",
  "with",
]);

/** Comparison key for service names: order, punctuation and filler words ignored. */
export function serviceMatchKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !SERVICE_FILLER_WORDS.has(word));
  const meaningful = words.length > 0 ? words : name.toLowerCase().replace(/[^a-z0-9]+/g, "").split("");
  return [...new Set(meaningful)].sort().join(" ");
}

/** True when two service names describe the same service. */
export function isSameService(left: string, right: string): boolean {
  return serviceMatchKey(left) === serviceMatchKey(right);
}

/**
 * Flags proposed services the tenant already has. Their existing wording,
 * price and duration always win: onboarding only ever adds what is missing.
 */
export function markExistingServices(
  proposal: OnboardingProposal,
  existingNames: readonly string[],
  existingAddonNames: readonly string[] = [],
): OnboardingProposal {
  const existing = new Set(existingNames.map((name) => serviceMatchKey(name)));
  const existingAddons = new Set(existingAddonNames.map((name) => serviceMatchKey(name)));
  return {
    ...proposal,
    services: proposal.services.map((service) => ({
      ...service,
      alreadyHave: existing.has(serviceMatchKey(service.name)),
    })),
    addons: proposal.addons.map((addon) => ({
      ...addon,
      alreadyHave: existingAddons.has(serviceMatchKey(addon.name)),
    })),
  };
}

const ADDON_WORDS = ["add on", "addon", "add-on", "extra", "upgrade", "optional", "additional"];

/**
 * True when a listed item reads like an extra rather than a standalone service:
 * the site labels it as an add-on/extra/upgrade, or prices it as a top-up
 * ("+$60", "additional $40"). Nothing else is reclassified, so a real service
 * is never demoted on a guess.
 */
export function looksLikeAddon(entry: {
  name?: string | null;
  price?: string | null;
  description?: string | null;
}): boolean {
  const label = `${entry.name ?? ""} ${entry.description ?? ""}`.toLowerCase().replace(/[^a-z0-9+ -]/g, " ");
  if (ADDON_WORDS.some((word) => label.includes(word))) return true;
  const price = (entry.price ?? "").trim();
  return price.startsWith("+");
}

function proposeServices(raw: ScrapedService[] | null | undefined): ProposedService[] {
  if (!Array.isArray(raw)) return [];
  const services: ProposedService[] = [];
  const names = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = text(entry.name, 80);
    if (!name || name.length < 2) continue;
    const key = serviceMatchKey(name);
    if (names.has(key)) continue;
    names.add(key);

    const duration = Number(entry.durationMinutes);
    services.push({
      name,
      description: text(entry.description, 600),
      price_guidance: text(entry.price, 200),
      duration_minutes:
        Number.isInteger(duration) && duration >= 15 && duration <= 1440
          ? duration
          : DEFAULT_SERVICE_DURATION_MINUTES,
      alreadyHave: false,
    });
    if (services.length >= MAX_PROPOSED_SERVICES) break;
  }
  return services;
}

/**
 * Turns extras listed on the site into proposed add-ons, each attached to the
 * services the site associates them with. An extra whose service cannot be
 * matched is attached to every proposed service, which the owner can narrow
 * before saving — nothing is ever invented.
 */
function proposeAddons(
  raw: ScrapedAddon[] | null | undefined,
  services: readonly ProposedService[],
): ProposedAddon[] {
  if (!Array.isArray(raw) || services.length === 0) return [];
  const addons: ProposedAddon[] = [];
  const names = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = text(entry.name, 80);
    if (!name || name.length < 2) continue;
    const key = serviceMatchKey(name);
    // An extra that repeats one of the services is not an extra.
    if (names.has(key) || services.some((service) => serviceMatchKey(service.name) === key)) continue;
    names.add(key);

    const declared = Array.isArray(entry.appliesTo) ? entry.appliesTo : [];
    const matched = services
      .filter((service) =>
        declared.some((label) => typeof label === "string" && isSameService(label, service.name)),
      )
      .map((service) => service.name);

    const duration = Number(entry.durationMinutes);
    addons.push({
      name,
      description: text(entry.description, 600),
      price_guidance: text(entry.price, 200),
      duration_minutes:
        Number.isInteger(duration) && duration >= 5 && duration <= 1440 ? duration : null,
      serviceNames: matched.length > 0 ? matched : services.map((service) => service.name),
      alreadyHave: false,
    });
    if (addons.length >= MAX_PROPOSED_SERVICES) break;
  }
  return addons;
}

/** Builds the owner-reviewable proposal from whatever the website provided. */
export function buildOnboardingProposal(site: ScrapedSite, sourceUrl: string): OnboardingProposal {
  // Some sites list their extras in the same block as their services. Anything
  // the page itself labels as an extra is treated as one, not as a service.
  const listed = Array.isArray(site.services) ? site.services : [];
  const listedServices = listed.filter((entry) => !looksLikeAddon(entry ?? {}));
  const listedAsAddons = listed
    .filter((entry) => looksLikeAddon(entry ?? {}))
    .map((entry) => ({
      name: entry?.name ?? null,
      price: entry?.price ?? null,
      description: entry?.description ?? null,
      durationMinutes: entry?.durationMinutes ?? null,
      appliesTo: null,
    }));

  const services = proposeServices(listedServices);
  const addons = proposeAddons(
    [...(Array.isArray(site.addons) ? site.addons : []), ...listedAsAddons],
    services,
  );
  const openingHours = text(site.openingHours, 200);
  const weeklyWindows = parseOpeningHours(openingHours);
  const serviceArea = text(site.serviceArea, 300) ?? text(site.suburb, 300);
  const phone = normaliseAuContactNumber(site.phone ?? null);
  const logoUrl = normaliseSiteUrl(site.logoUrl ?? null);

  const warnings: string[] = [];
  if (!text(site.businessName, 80)) warnings.push("We could not find a business name on the site.");
  if (services.length === 0) warnings.push("No services or prices were listed, so you'll add those yourself.");
  else if (services.every((service) => !service.price_guidance))
    warnings.push("The site lists services but no prices, so prices are left blank.");
  if (weeklyWindows.length === 0)
    warnings.push("Opening hours could not be read as bookable times, so set your availability manually.");
  if (!phone && site.phone) warnings.push("The phone number on the site did not look like an Australian number.");
  if (!logoUrl) warnings.push("No logo image was found.");

  return {
    sourceUrl,
    business: {
      name: text(site.businessName, 80),
      service_area: serviceArea,
      opening_hours: openingHours,
      phone_number: phone,
    },
    logoUrl,
    services,
    addons,
    weeklyWindows,
    warnings,
  };
}
