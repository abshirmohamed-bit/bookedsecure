// Server-only tenant resolution for the public quote form.
// Tenant identity comes from the slug in the URL and nothing else: no browser-supplied
// business id is ever trusted, and an unknown/inactive slug resolves to null (never a default).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseSlug } from "@/lib/tenant-slug";
import { sanitiseLogoUrl } from "@/lib/tenant-branding";
import { resolveQuoteMode, type QuoteMode } from "@/lib/quote-mode";
import type { ServiceAddon } from "@/lib/service-addons";
import { sanitiseServiceImageUrl } from "@/lib/service-images";
import { quoteSubjectLabel, quoteSubjectOptions } from "@/lib/domain";

export type PublicService = {
  id: string;
  name: string;
  /** The tenant's own grouping heading, or null. */
  category: string | null;
  /** Appointment length in minutes, when the tenant has set one. */
  duration_minutes: number | null;
  description: string | null;
  qualification_note: string | null;
  included_items: string | null;
  excluded_items: string | null;
  price_guidance: string | null;
  campaign_eligible: boolean;
  /** Public address of the tenant's own picture for this service, or null. */
  image_url: string | null;
};

export type PublicTenant = {
  businessId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  serviceArea: string | null;
  privacyPolicyUrl: string | null;
  flexibleRequestsEnabled: boolean;
  quoteMode: QuoteMode;
  /** Customer-facing label for the item being serviced (e.g. Vehicle, Property, Lawn). */
  quoteSubjectLabel: string;
  /** Dropdown options for the quote subject. */
  quoteSubjectOptions: string[];
  services: PublicService[];
  /** The tenant's own active add-on extras, each linked to their services. */
  addons: ServiceAddon[];
};

/** Resolves an active tenant with an active quote form, or null. */
export async function resolvePublicTenant(rawSlug: string | null | undefined): Promise<PublicTenant | null> {
  const slug = normaliseSlug(rawSlug);
  if (!slug) return null;

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, slug, logo_url, service_area, privacy_policy_url, status, quote_form_active, flexible_requests_enabled, quote_mode, quote_subject_label, quote_subject_options",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!business || business.status !== "active" || business.quote_form_active !== true) return null;

  const { data: services } = await supabaseAdmin
    .from("services")
    .select(
      "id, name, category, duration_minutes, description, qualification_note, included_items, excluded_items, price_guidance, campaign_eligible, image_url",
    )
    .eq("business_id", business.id)
    .eq("active", true)
    .order("name", { ascending: true });

  const { data: addonRows } = await supabaseAdmin
    .from("service_addons")
    .select(
      "id, name, category, description, price_guidance, duration_minutes, active, image_url, service_addon_links(service_id)",
    )
    .eq("business_id", business.id)
    .eq("active", true)
    .order("name", { ascending: true });

  const activeServiceIds = new Set((services ?? []).map((service) => service.id));
  const addons: ServiceAddon[] = (addonRows ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category ?? null,
      description: row.description ?? null,
      price_guidance: row.price_guidance ?? null,
      duration_minutes: row.duration_minutes ?? null,
      image_url: sanitiseServiceImageUrl(row.image_url),
      active: true,
      // An add-on is only ever offered with this tenant's own active services.
      serviceIds: ((row as { service_addon_links?: { service_id: string }[] }).service_addon_links ?? [])
        .map((link) => link.service_id)
        .filter((serviceId) => activeServiceIds.has(serviceId)),
    }))
    .filter((addon) => addon.serviceIds.length > 0);

  return {
    businessId: business.id,
    slug,
    addons,
    name: business.name,
    logoUrl: sanitiseLogoUrl(business.logo_url),
    serviceArea: business.service_area ?? null,
    privacyPolicyUrl: business.privacy_policy_url ?? null,
    flexibleRequestsEnabled: business.flexible_requests_enabled !== false,
    // Unknown / missing mode never fails open into the AI experience.
    quoteMode: resolveQuoteMode(business.quote_mode),
    services: (services ?? []).map((service) => ({
      id: service.id,
      name: service.name,
      category: service.category ?? null,
      duration_minutes: service.duration_minutes ?? null,
      description: service.description ?? null,
      qualification_note: service.qualification_note ?? null,
      included_items: service.included_items ?? null,
      excluded_items: service.excluded_items ?? null,
      price_guidance: service.price_guidance ?? null,
      campaign_eligible: service.campaign_eligible !== false,
      image_url: sanitiseServiceImageUrl(service.image_url),
    })),
  };
}

/**
 * Verifies a submitted service id belongs to the resolved tenant and is active.
 * Returns the historical name snapshot. A mismatch throws — never silently dropped.
 */
export async function resolveTenantService(
  businessId: string,
  serviceId: string,
): Promise<{ id: string; name: string }> {
  const { data } = await supabaseAdmin
    .from("services")
    .select("id, name, business_id, active")
    .eq("id", serviceId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data || data.active !== true) {
    throw new Error("That service is not available for this business.");
  }
  return { id: data.id, name: data.name };
}
