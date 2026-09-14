/**
 * Service / add-on picture policy (pure, no I/O).
 *
 * Pictures are presentation only: they never affect pricing, booking or
 * messaging. Files live in the tenant's own storage folder (first segment is
 * the business id) and are served through a public route keyed by the row id,
 * so a caller can never read another tenant's file by guessing a path.
 */
import { isOwnTenantLogoPath, validateLogoUpload, type LogoValidationResult } from "@/lib/tenant-logo";

export type ServiceImageKind = "service" | "addon";

export const SERVICE_IMAGE_KINDS: readonly ServiceImageKind[] = ["service", "addon"];

export function isServiceImageKind(value: unknown): value is ServiceImageKind {
  return value === "service" || value === "addon";
}

/** Same size and type rules as the business logo. */
export const validateServiceImageUpload: (input: {
  contentType: string;
  size: number;
}) => LogoValidationResult = validateLogoUpload;

/** Tenant-scoped object path; the business id is always the first folder. */
export function serviceImagePath(
  businessId: string,
  kind: ServiceImageKind,
  rowId: string,
  extension: string,
  unique: string,
): string {
  const safeExtension = extension.replace(/[^a-z0-9]/g, "");
  const safeUnique = unique.replace(/[^a-zA-Z0-9-]/g, "");
  const safeRow = rowId.replace(/[^a-zA-Z0-9-]/g, "");
  return `${businessId}/${kind}-${safeRow}-${safeUnique}.${safeExtension}`;
}

export const isOwnServiceImagePath = isOwnTenantLogoPath;

/** Public, cacheable address for a stored picture. The marker busts caches on replace. */
export function serviceImageDisplayUrl(kind: ServiceImageKind, rowId: string, unique: string): string {
  const safeUnique = unique.replace(/[^a-zA-Z0-9-]/g, "");
  return `/api/public/service-image/${kind}/${rowId}?v=${safeUnique}`;
}

/**
 * Only http(s) addresses are ever fetched when copying a picture from a
 * tenant's website. Relative addresses are resolved against the site URL.
 */
export function resolveRemoteImageUrl(candidate: unknown, baseUrl: string): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Only our own public route or an https address may be shown in the UI. */
export function sanitiseServiceImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/api/public/service-image/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
