/**
 * Website-based tenant onboarding: I/O layer.
 *
 * Reading a website is a *read-only preview*. Nothing is written until the owner
 * approves the proposal, and every write is scoped to the caller's own business
 * resolved from the authenticated session.
 */
import type { AppContext } from "@/lib/app-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isValidTimezone } from "@/lib/availability";
import { ALLOWED_LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/tenant-logo";
import { storeTenantLogo } from "@/lib/tenant-account.server";
import { copyServiceImageFromUrl } from "@/lib/service-images.server";
import { resolveRemoteImageUrl } from "@/lib/service-images";
import {
  buildOnboardingProposal,
  markExistingServices,
  serviceMatchKey,
  isSameService,
  normaliseSiteUrl,
  type OnboardingProposal,
  type ScrapedSite,
} from "@/lib/site-onboarding";

const GATEWAY_SCRAPE_URL = "https://connector-gateway.lovable.dev/firecrawl/v2/scrape";
const GATEWAY_MAP_URL = "https://connector-gateway.lovable.dev/firecrawl/v2/map";
const MAX_SERVICE_PAGES = 10;

const EXTRACTION_PROMPT = [
  "Read this business website and extract only what the page actually states.",
  "Return the trading name, the suburb/city, the areas or suburbs served, the public contact phone number,",
  "the opening hours exactly as written, and the list of services offered.",
  "For each service include its name, its price exactly as written on the page (including any 'from'),",
  "a one-line description, the appointment length in minutes only if the page states a time (never estimate one), and the heading or",
  "category the page groups it under (for example the selected tab, an on-page filter or section heading), copied exactly.",
  "When a price table lists sizes or variants with their own prices (for example Small / Medium / Large, or 2 seater / 5 seater),",
  "return every priced row as its own service named '<card heading> - <row label>', with that row's price.",
  "Include every priced card and table visible on the page; do not stop after the first few.",
  "Separately, list any optional add-on extras or upgrades sold on top of a service",
  "(for example an extra treatment added to a detail), with the extra's name, its price exactly as written,",
  "a one-line description, the extra time in minutes if stated, the heading it is grouped under if any,",
  "and the names of the services it applies to.",
  "Do not repeat a main service as an add-on.",
  "When a service or extra has a picture beside it (a photo on its card or price block), include that",
  "image's full absolute address as imageUrl; leave imageUrl out when there is no picture for that item.",
  "Never invent a value. Leave a field out when the page does not state it.",
].join(" ");

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    businessName: { type: "string" },
    suburb: { type: "string" },
    serviceArea: { type: "string" },
    phone: { type: "string" },
    openingHours: { type: "string" },
    services: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          group: { type: "string" },
          price: { type: "string" },
          description: { type: "string" },
          durationMinutes: { type: "number" },
          imageUrl: { type: "string" },
        },
      },
    },
    addons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          group: { type: "string" },
          price: { type: "string" },
          description: { type: "string" },
          durationMinutes: { type: "number" },
          appliesTo: { type: "array", items: { type: "string" } },
          imageUrl: { type: "string" },
        },
      },
    },
  },
} as const;

function requireOwnerRole(app: AppContext): void {
  if (app.role !== "owner") throw new Error("Only the business owner can onboard from a website.");
}

type FirecrawlScrape = {
  json?: unknown;
  branding?: { logo?: string | null; images?: { logo?: string | null } | null } | null;
  metadata?: { title?: string | null } | null;
  data?: FirecrawlScrape;
};

type FirecrawlMap = {
  links?: Array<string | { url?: string | null }>;
  data?: { links?: Array<string | { url?: string | null }> } | null;
};

/** Turns relative picture addresses from the site into absolute ones. */
function withAbsoluteImages<T extends { imageUrl?: string | null }>(raw: unknown, base: string): T[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((entry) =>
    entry && typeof entry === "object"
      ? ({ ...(entry as T), imageUrl: resolveRemoteImageUrl((entry as T).imageUrl, base) } as T)
      : (entry as T),
  );
}

function unwrap(payload: FirecrawlScrape): FirecrawlScrape {
  return payload.data && typeof payload.data === "object" ? { ...payload.data, ...payload } : payload;
}

function connectorHeaders(lovableKey: string, connectionKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
  };
}

function mappedUrls(payload: FirecrawlMap, siteUrl: string): string[] {
  const raw = payload.links ?? payload.data?.links ?? [];
  const origin = new URL(siteUrl).origin;
  const scored = raw
    .map((entry) => (typeof entry === "string" ? entry : entry.url ?? ""))
    .filter((entry) => {
      try {
        const candidate = new URL(entry, siteUrl);
        return candidate.origin === origin && candidate.href !== siteUrl;
      } catch {
        return false;
      }
    })
    .map((entry) => {
      const url = new URL(entry, siteUrl).toString();
      const path = url.toLowerCase();
      const score = ["service", "pricing", "price", "book", "detail", "coating", "package", "extra"].reduce(
        (total, word) => total + (path.includes(word) ? 1 : 0),
        0,
      );
      return { url, score };
    })
    .sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((entry) => entry.url))].slice(0, MAX_SERVICE_PAGES);
}

function mergeScrapedItems<T extends { name?: string | null; imageUrl?: string | null }>(
  groups: Array<T[] | null>,
): T[] | null {
  const merged = new Map<string, T>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const key = serviceMatchKey(item.name ?? "");
      if (!key) continue;
      const current = merged.get(key);
      if (!current || (!current.imageUrl && item.imageUrl)) merged.set(key, { ...current, ...item });
    }
  }
  return merged.size > 0 ? [...merged.values()] : null;
}

/** Most sites keep a handful of service tabs; more than this is almost certainly not a tab strip. */
const MAX_SERVICE_TABS = 6;

/**
 * Marks on-page tab or filter buttons (e.g. "Detail Packages | Ceramic Coatings | Tint & PPF")
 * so each tab's hidden prices can be opened and read. Skips navigation, footer, forms, the top
 * bar and anything that would leave the page. Returns how many tabs were found.
 */
const TAG_TABS_SCRIPT = `(()=>{const short=(e)=>{const t=(e.innerText||'').trim();return t.length>0&&t.length<=40&&!t.includes('\\n');};
const els=[...document.querySelectorAll('[role="tab"],button,[tabindex="0"],[data-highlight="true"]')].filter((e)=>{
if(!short(e))return false;if(e.closest('nav,footer,form'))return false;
if(e.getBoundingClientRect().top+window.scrollY<150)return false;
const a=e.closest('a[href]');if(a){const u=new URL(a.href,location.href);if(u.origin!==location.origin||u.pathname!==location.pathname)return false;}
const p=e.parentElement;if(!p)return false;const sib=[...p.children].filter(short);return sib.length>=2&&sib.length<=${MAX_SERVICE_TABS + 2};});
const uniq=[];for(const e of els){if(!uniq.some((u)=>u.contains(e)||e.contains(u)))uniq.push(e);}
const groups=new Map();for(const e of uniq){const k=e.parentElement;groups.set(k,[...(groups.get(k)||[]),e]);}
const strip=[...groups.values()].filter((g)=>g.length>=2).sort((a,b)=>b.length-a.length)[0]||[];
strip.slice(0,${MAX_SERVICE_TABS}).forEach((e,i)=>e.setAttribute('data-bs-tab',String(i)));return strip.length;})()`;

function clickTabScript(index: number): string {
  return `(()=>{const e=document.querySelector('[data-bs-tab="${index}"]');if(!e)return false;for(const t of ["pointerdown","mousedown","pointerup","mouseup","click"])e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));return true;})()`;
}

type ScrapeResult = {
  url: string;
  payload: FirecrawlScrape;
  extracted: Record<string, unknown>;
  tabCount: number;
};

const MAX_SCRAPE_ATTEMPTS = 4;
const MAX_CONCURRENT_SCRAPES = 3;
const MAX_RETRY_WAIT_MS = 20_000;

/** Pages that still failed after retries during the current read (per request). */
let skippedPages = { count: 0 };

let activeScrapes = 0;
const scrapeQueue: Array<() => void> = [];

/** Keeps only a few website reads running at once so the reader is not rate limited. */
async function withScrapeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) {
    await new Promise<void>((resolve) => scrapeQueue.push(resolve));
  }
  activeScrapes++;
  try {
    return await run();
  } finally {
    activeScrapes--;
    scrapeQueue.shift()?.();
  }
}

/** Honours the provider's "retry after" hint, falling back to exponential backoff. */
function retryDelayMs(response: Response, body: string, attempt: number): number {
  const header = Number(response.headers.get("retry-after"));
  const fromBody = /retry after (\d+(?:\.\d+)?)\s*s/i.exec(body)?.[1];
  const seconds = Number.isFinite(header) && header > 0 ? header : fromBody ? Number(fromBody) : 2 ** (attempt + 1);
  return Math.min(Math.max(seconds * 1000, 1000), MAX_RETRY_WAIT_MS) + Math.floor(Math.random() * 500);
}

async function scrapePage(
  url: string,
  lovableKey: string,
  connectionKey: string,
  options: { tabIndex?: number; withBranding?: boolean } = {},
): Promise<ScrapeResult | null> {
  const actions: Array<Record<string, unknown>> = [
    { type: "wait", milliseconds: 2000 },
    { type: "executeJavascript", script: TAG_TABS_SCRIPT },
  ];
  if (options.tabIndex !== undefined) {
    actions.push(
      { type: "executeJavascript", script: clickTabScript(options.tabIndex) },
      { type: "wait", milliseconds: 1000 },
    );
  }
  const json = { type: "json", schema: EXTRACTION_SCHEMA, prompt: EXTRACTION_PROMPT };
  const body = JSON.stringify({
    url,
    onlyMainContent: false,
    actions,
    formats: options.withBranding === false ? [json] : ["branding", json],
  });
  let response: Response | null = null;
  for (let attempt = 0; attempt < MAX_SCRAPE_ATTEMPTS; attempt++) {
    response = await withScrapeSlot(() =>
      fetch(GATEWAY_SCRAPE_URL, { method: "POST", headers: connectorHeaders(lovableKey, connectionKey), body }),
    );
    if (response.status !== 429 || attempt === MAX_SCRAPE_ATTEMPTS - 1) break;
    const text = await response.text();
    const waitMs = retryDelayMs(response, text, attempt);
    console.warn(`[site-onboarding] rate limited, retrying in ${waitMs}ms ${url}`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  if (!response || !response.ok) {
    console.error(`[site-onboarding] scrape failed [${response?.status}] ${url}`, await response?.text());
    skippedPages.count++;
    return null;
  }
  const raw = (await response.json()) as FirecrawlScrape & {
    actions?: { javascriptReturns?: Array<{ value?: unknown }> };
    data?: { actions?: { javascriptReturns?: Array<{ value?: unknown }> } };
  };
  const returns = raw.data?.actions?.javascriptReturns ?? raw.actions?.javascriptReturns ?? [];
  const tabCount = typeof returns[0]?.value === "number" ? (returns[0].value as number) : 0;
  const payload = unwrap(raw);
  return { url, payload, extracted: (payload.json ?? {}) as Record<string, unknown>, tabCount };
}

/** Opens every other service tab on a page and reads it, so hidden prices are not missed. */
async function scrapeOtherTabs(
  page: ScrapeResult,
  lovableKey: string,
  connectionKey: string,
): Promise<ScrapeResult[]> {
  const count = Math.min(page.tabCount, MAX_SERVICE_TABS);
  if (count < 2) return [];
  const results = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      scrapePage(page.url, lovableKey, connectionKey, { tabIndex: index, withBranding: false }),
    ),
  );
  return results.filter((result): result is ScrapeResult => result !== null);
}

/** Reads the tenant's own public website through the Firecrawl connector. */
export async function previewSiteOnboarding(app: AppContext, rawUrl: string): Promise<OnboardingProposal> {
  requireOwnerRole(app);
  const url = normaliseSiteUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a website address. Try something like yourbusiness.com.au");

  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["FIRECRAWL_API_KEY"];
  if (!lovableKey || !connectionKey) throw new Error("Website reading is not configured yet.");

  skippedPages = { count: 0 };
  const skipped = skippedPages;
  const root = await scrapePage(url, lovableKey, connectionKey);
  if (!root) {
    throw new Error(
      "That website could not be read. Check the address, or set your details up manually.",
    );
  }

  const mapResponse = await fetch(GATEWAY_MAP_URL, {
    method: "POST",
    headers: connectorHeaders(lovableKey, connectionKey),
    body: JSON.stringify({ url, limit: 100, includeSubdomains: false }),
  });
  const pageUrls = mapResponse.ok ? mappedUrls((await mapResponse.json()) as FirecrawlMap, url) : [];
  const pageResults = (
    await Promise.all(pageUrls.map((pageUrl) => scrapePage(pageUrl, lovableKey, connectionKey, { withBranding: false })))
  ).filter((result): result is ScrapeResult => result !== null);
  const tabResults = (
    await Promise.all(
      [root, ...pageResults].map((page) => scrapeOtherTabs(page, lovableKey, connectionKey)),
    )
  ).flat();
  const allPages = [root, ...pageResults, ...tabResults];

  const payload = root.payload;
  const extracted = root.extracted;
  const services = mergeScrapedItems(
    allPages.map((result) => withAbsoluteImages(result.extracted["services"], result.url)),
  );
  const addons = mergeScrapedItems(
    allPages.map((result) => withAbsoluteImages(result.extracted["addons"], result.url)),
  );

  if (!payload) {
    throw new Error(
      mapResponse.status === 402 || mapResponse.status === 403
        ? "Website reading is temporarily unavailable. Try again shortly."
        : "That website could not be read. Check the address, or set your details up manually.",
    );
  }
  const branding = payload.branding ?? null;

  const site: ScrapedSite = {
    businessName:
      (extracted["businessName"] as string | undefined) ?? payload.metadata?.title ?? null,
    suburb: (extracted["suburb"] as string | undefined) ?? null,
    serviceArea: (extracted["serviceArea"] as string | undefined) ?? null,
    phone: (extracted["phone"] as string | undefined) ?? null,
    openingHours: (extracted["openingHours"] as string | undefined) ?? null,
    logoUrl: branding?.logo ?? branding?.images?.logo ?? null,
    services,
    addons,
  };

  const proposal = buildOnboardingProposal(site, url);
  if (skipped.count > 0) {
    proposal.warnings.push(
      `${skipped.count} page${skipped.count === 1 ? "" : "s"} of your site could not be read right now, so some services or prices may be missing. Try "Read my site" again in a minute.`,
    );
  }

  // Show the owner up front which of their services already exist, so the
  // preview matches exactly what saving will do.
  const [{ data: existing }, { data: existingAddons }] = await Promise.all([
    supabaseAdmin.from("services").select("name").eq("business_id", app.businessId),
    supabaseAdmin.from("service_addons").select("name").eq("business_id", app.businessId),
  ]);
  return markExistingServices(
    proposal,
    (existing ?? []).map((row) => row.name),
    (existingAddons ?? []).map((row) => row.name),
  );
}

async function copyLogo(app: AppContext, logoUrl: string): Promise<boolean> {
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return false;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(contentType in ALLOWED_LOGO_TYPES)) return false;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return false;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await storeTenantLogo(app, { content_type: contentType, data_base64: btoa(binary) });
    return true;
  } catch (error) {
    console.error("[site-onboarding] logo copy failed", error);
    return false;
  }
}

export type ApplyOutcome = {
  ok: true;
  businessUpdated: boolean;
  servicesAdded: number;
  servicesSkipped: number;
  addonsAdded: number;
  addonsSkipped: number;
  availabilityWindows: number;
  availabilityActive: boolean;
  logoSaved: boolean;
  notes: string[];
};

/** Saves an owner-approved proposal. Existing services are never overwritten. */
export async function applySiteOnboarding(
  app: AppContext,
  proposal: OnboardingProposal,
): Promise<ApplyOutcome> {
  requireOwnerRole(app);
  const notes: string[] = [];

  const businessPatch: {
    name?: string;
    service_area?: string;
    opening_hours?: string;
    phone_number?: string;
  } = {};
  if (proposal.business.name) businessPatch.name = proposal.business.name;
  if (proposal.business.service_area) businessPatch.service_area = proposal.business.service_area;
  if (proposal.business.opening_hours) businessPatch.opening_hours = proposal.business.opening_hours;
  if (proposal.business.phone_number) businessPatch.phone_number = proposal.business.phone_number;

  if (Object.keys(businessPatch).length > 0) {
    const { error } = await supabaseAdmin.from("businesses").update(businessPatch).eq("id", app.businessId);
    if (error) throw new Error(error.message);
  }

  const { data: existingServices } = await supabaseAdmin
    .from("services")
    .select("id, name, image_url")
    .eq("business_id", app.businessId);
  const taken = new Set((existingServices ?? []).map((row) => serviceMatchKey(row.name)));

  const rows = proposal.services
    .filter((service) => !taken.has(serviceMatchKey(service.name)))
    .map((service) => ({
      business_id: app.businessId,
      name: service.name,
      category: service.category,
      description: service.description,
      price_guidance: service.price_guidance,
      duration_minutes: service.duration_minutes,
      campaign_eligible: true,
      active: true,
    }));
  let imagesCopied = 0;
  let imagesSkipped = 0;
  for (const existing of existingServices ?? []) {
    if (existing.image_url) continue;
    const source = proposal.services.find((service) => isSameService(service.name, existing.name));
    const imageUrl = source ? resolveRemoteImageUrl(source.image_url, proposal.sourceUrl) : null;
    if (!imageUrl) continue;
    if (await copyServiceImageFromUrl(app, "service", existing.id, imageUrl)) imagesCopied += 1;
    else imagesSkipped += 1;
  }
  if (rows.length > 0) {
    const { data: inserted, error } = await supabaseAdmin
      .from("services")
      .insert(rows)
      .select("id, name");
    if (error) throw new Error(error.message);
    for (const created of inserted ?? []) {
      const source = proposal.services.find((service) => isSameService(service.name, created.name));
      const imageUrl = source ? resolveRemoteImageUrl(source.image_url, proposal.sourceUrl) : null;
      if (!imageUrl) continue;
      if (await copyServiceImageFromUrl(app, "service", created.id, imageUrl)) imagesCopied += 1;
      else imagesSkipped += 1;
    }
  }
  const skipped = proposal.services.length - rows.length;
  if (skipped > 0)
    notes.push(`${skipped} service(s) you already offer were left exactly as they are.`);

  // Add-on extras are attached to the tenant's OWN services. the ones just
  // added and the ones they already had. An extra they already have is never
  // touched, and an extra that matches no service of theirs is not saved.
  const { data: allServices } = await supabaseAdmin
    .from("services")
    .select("id, name")
    .eq("business_id", app.businessId);
  const { data: currentAddons } = await supabaseAdmin
    .from("service_addons")
    .select("id, name, image_url")
    .eq("business_id", app.businessId);
  const addonTaken = new Set((currentAddons ?? []).map((row) => serviceMatchKey(row.name)));

  for (const existing of currentAddons ?? []) {
    if (existing.image_url) continue;
    const source = proposal.addons.find((addon) => isSameService(addon.name, existing.name));
    const imageUrl = source ? resolveRemoteImageUrl(source.image_url, proposal.sourceUrl) : null;
    if (!imageUrl) continue;
    if (await copyServiceImageFromUrl(app, "addon", existing.id, imageUrl)) imagesCopied += 1;
    else imagesSkipped += 1;
  }

  let addonsAdded = 0;
  let addonsSkipped = 0;
  for (const addon of proposal.addons) {
    if (addonTaken.has(serviceMatchKey(addon.name))) {
      addonsSkipped += 1;
      continue;
    }
    const linked = (allServices ?? []).filter((service) =>
      addon.serviceNames.some((name) => isSameService(name, service.name)),
    );
    if (linked.length === 0) {
      addonsSkipped += 1;
      continue;
    }
    const { data: created, error } = await supabaseAdmin
      .from("service_addons")
      .insert({
        business_id: app.businessId,
        name: addon.name,
        category: addon.category,
        description: addon.description,
        price_guidance: addon.price_guidance,
        duration_minutes: addon.duration_minutes,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: linkError } = await supabaseAdmin.from("service_addon_links").insert(
      linked.map((service) => ({
        business_id: app.businessId,
        addon_id: created.id,
        service_id: service.id,
      })),
    );
    if (linkError) throw new Error(linkError.message);
    addonTaken.add(serviceMatchKey(addon.name));
    addonsAdded += 1;
    const addonImage = resolveRemoteImageUrl(addon.image_url, proposal.sourceUrl);
    if (addonImage) {
      if (await copyServiceImageFromUrl(app, "addon", created.id, addonImage)) imagesCopied += 1;
      else imagesSkipped += 1;
    }
  }
  if (imagesCopied > 0) notes.push(`${imagesCopied} picture(s) copied onto your service cards.`);
  if (imagesSkipped > 0)
    notes.push(`${imagesSkipped} picture(s) could not be copied (too large or not an image) and were skipped.`);
  if (addonsSkipped > 0)
    notes.push(`${addonsSkipped} extra(s) were skipped because you already have them.`);

  let availabilityActive = false;
  if (proposal.weeklyWindows.length > 0) {
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("timezone")
      .eq("id", app.businessId)
      .single();
    availabilityActive = isValidTimezone(business?.timezone);
    if (!availabilityActive)
      notes.push("Bookable times were saved but stay switched off until a valid timezone is set.");

    const { data: current } = await supabaseAdmin
      .from("booking_availability")
      .select("lead_time_minutes, horizon_days, offer_ttl_minutes")
      .eq("business_id", app.businessId)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("booking_availability").upsert(
      {
        business_id: app.businessId,
        active: availabilityActive,
        lead_time_minutes: current?.lead_time_minutes ?? 120,
        horizon_days: current?.horizon_days ?? 14,
        offer_ttl_minutes: current?.offer_ttl_minutes ?? 120,
        weekly_windows: proposal.weeklyWindows as never,
      },
      { onConflict: "business_id" },
    );
    if (error) throw new Error(error.message);
  }

  const logoSaved = proposal.logoUrl ? await copyLogo(app, proposal.logoUrl) : false;
  if (proposal.logoUrl && !logoSaved) notes.push("The logo could not be copied across, so upload it yourself.");

  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: app.businessId,
    userId: app.userId,
    eventType: "site_onboarding_applied",
    entityType: "business",
    entityId: app.businessId,
    metadata: {
      source_url: proposal.sourceUrl,
      services_added: rows.length,
      addons_added: addonsAdded,
      windows: proposal.weeklyWindows.length,
      logo_saved: logoSaved,
    },
  });

  return {
    ok: true,
    businessUpdated: Object.keys(businessPatch).length > 0,
    servicesAdded: rows.length,
    servicesSkipped: skipped,
    addonsAdded,
    addonsSkipped,
    availabilityWindows: proposal.weeklyWindows.length,
    availabilityActive,
    logoSaved,
    notes,
  };
}
