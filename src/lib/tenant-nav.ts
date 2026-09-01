// Pure helpers for the authenticated dashboard's tenant-aware quote-page control.
//
// The dashboard must only ever surface the signed-in tenant's own public URL.
// There is deliberately no fallback to the bare `/quote` path: when the tenant
// has no usable slug the control is hidden instead of guessing a tenant.

import { normaliseSlug } from "@/lib/tenant-slug";

export type DashboardTenant = {
  name: string | null;
  slug: string | null;
  logoUrl: string | null;
};

/** Relative public quote path for a tenant, or null when no valid slug exists. */
export function tenantQuotePath(slug: string | null | undefined): string | null {
  const normalised = normaliseSlug(slug);
  return normalised ? `/quote/${normalised}` : null;
}

/** Absolute, copyable public quote URL. Null when slug or origin is unusable. */
export function tenantQuoteUrl(
  origin: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  const path = tenantQuotePath(slug);
  if (!path) return null;
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    return null;
  }
}

/** Header label for the authenticated tenant; never hardcodes a tenant name. */
export function tenantHeaderTitle(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  return value ? `${value} Lead Response` : "Lead Response";
}
