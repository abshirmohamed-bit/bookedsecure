// Pure helpers for tenant quote-form slugs. Shared by the public route and server resolution.

/** Maximum stored slug length. Keeps public URLs short and predictable. */
export const MAX_SLUG_LENGTH = 40;

/**
 * Canonical slug form: lowercase, hyphen separated, no leading/trailing hyphen.
 * Returns null when nothing usable remains. callers must treat null as "unknown tenant",
 * never as "use the default tenant".
 */
export function normaliseSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");
  return cleaned.length >= 2 ? cleaned : null;
}

export function isValidSlug(raw: string | null | undefined): boolean {
  return normaliseSlug(raw) !== null && normaliseSlug(raw) === (raw ?? "").trim().toLowerCase();
}

/**
 * Explicit legacy mapping for the bare `/quote` path.
 * Deliberately empty: `/quote` must never silently resolve to a tenant.
 * An owner adds an entry here consciously if an old public link must keep working.
 */
export const LEGACY_SLUG_ALIASES: Readonly<Record<string, string>> = Object.freeze({});

export function resolveLegacyAlias(alias: string | null | undefined): string | null {
  const key = normaliseSlug(alias);
  if (!key) return null;
  return LEGACY_SLUG_ALIASES[key] ?? null;
}
