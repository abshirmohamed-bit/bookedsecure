/**
 * Tenant branding helpers for the public quote form.
 *
 * A tenant logo is operator-supplied data, so it is never rendered raw: only
 * absolute https URLs and same-origin absolute paths are accepted. Anything
 * else (javascript:, data:, protocol-relative, plain http, blank) resolves to
 * null so the caller falls back to the initial badge.
 */

const MAX_LOGO_URL_LENGTH = 500;

export function sanitiseLogoUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LOGO_URL_LENGTH) return null;

  // Same-origin absolute path (e.g. CDN-backed asset paths), never "//host".
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Single-character fallback mark derived from the tenant name. */
export function brandInitial(name: string | null | undefined): string {
  const letter = (name ?? "").trim().slice(0, 1);
  return letter ? letter.toUpperCase() : "?";
}
