// Server-only tenant resolution for the public quote form.
// Tenant identity comes from the slug in the URL and nothing else: no browser-supplied
// business id is ever trusted, and an unknown/inactive slug resolves to null (never a default).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseSlug } from "@/lib/tenant-slug";
import { sanitiseLogoUrl } from "@/lib/tenant-branding";

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  qualification_note: string | null;
};

export type PublicTenant = {
  businessId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  serviceArea: string | null;
  privacyPolicyUrl: string | null;
  flexibleRequestsEnabled: boolean;
  services: PublicService[];
};

/** Resolves an active tenant with an active quote form, or null. */
export async function resolvePublicTenant(rawSlug: string | null | undefined): Promise<PublicTenant | null> {
  const slug = normaliseSlug(rawSlug);
  if (!slug) return null;

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, slug, logo_url, service_area, privacy_policy_url, status, quote_form_active, flexible_requests_enabled",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!business || business.status !== "active" || business.quote_form_active !== true) return null;

  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, name, description, qualification_note")
    .eq("business_id", business.id)
    .eq("active", true)
    .order("name", { ascending: true });

  return {
    businessId: business.id,
    slug,
    name: business.name,
    logoUrl: business.logo_url ?? null,
    serviceArea: business.service_area ?? null,
    privacyPolicyUrl: business.privacy_policy_url ?? null,
    flexibleRequestsEnabled: business.flexible_requests_enabled !== false,
    services: (services ?? []).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description ?? null,
      qualification_note: service.qualification_note ?? null,
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
