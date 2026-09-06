/**
 * Business logo upload policy (pure, no I/O).
 *
 * The logo is visual branding only. It is never included in SMS, and it never
 * affects booking, availability or messaging behaviour. Files live in
 * tenant-scoped storage under the business id, so one tenant can never read or
 * replace another tenant's logo.
 */

export const TENANT_LOGO_BUCKET = "tenant-logos";

/** SVG is deliberately excluded: it can carry active content. */
export const ALLOWED_LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AllowedLogoType = keyof typeof ALLOWED_LOGO_TYPES;

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_LOGO_PIXELS = 2048; // longest edge, checked in the browser

export type LogoValidationResult =
  | { ok: true; contentType: AllowedLogoType; extension: string }
  | { ok: false; reason: string };

export function validateLogoUpload(input: {
  contentType: string;
  size: number;
}): LogoValidationResult {
  const contentType = (input.contentType ?? "").toLowerCase().trim() as AllowedLogoType;
  const extension = ALLOWED_LOGO_TYPES[contentType];
  if (!extension) {
    return {
      ok: false,
      reason: "That file type is not supported. Use a PNG, JPEG or WebP image.",
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "That file appears to be empty." };
  }
  if (input.size > MAX_LOGO_BYTES) {
    return { ok: false, reason: "That image is too large. Use a file under 2 MB." };
  }
  return { ok: true, contentType, extension };
}

/** Tenant-scoped object path. The business id is always the first folder. */
export function tenantLogoPath(businessId: string, extension: string, unique: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/g, "");
  const safeUnique = unique.replace(/[^a-zA-Z0-9-]/g, "");
  return `${businessId}/logo-${safeUnique}.${safeExtension}`;
}

/** True when this storage path belongs to the given business. */
export function isOwnTenantLogoPath(businessId: string, path: string | null | undefined): boolean {
  if (!path) return false;
  const [folder, ...rest] = path.split("/");
  return folder === businessId && rest.length > 0 && !path.includes("..");
}
