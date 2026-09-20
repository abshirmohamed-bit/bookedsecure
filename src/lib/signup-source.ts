/**
 * Where a new tenant came from.
 *
 * The public start page remembers the campaign tags it was opened with, and the
 * sign-up flow hands them to the server once, so every business that arrives
 * from an ad can be attributed. Browser-safe: no server imports.
 */

const STORAGE_KEY = "bs.signup.source";

export type SignupSource = { source: string | null; ref: string | null };

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
}

/** Reads the tags from a URL search object (ref / utm_source / c / source). */
export function readSignupSource(search: Record<string, unknown>): SignupSource {
  const pick = (key: string) => clean(typeof search[key] === "string" ? (search[key] as string) : null);
  return {
    source: pick("utm_source") ?? pick("source") ?? pick("ref"),
    ref: pick("ref") ?? pick("c") ?? pick("utm_campaign"),
  };
}

/** Keeps the tags across the sign-up round trip (email confirmation included). */
export function rememberSignupSource(value: SignupSource): void {
  if (typeof window === "undefined") return;
  if (!value.source && !value.ref) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing: attribution is a nice-to-have, never a blocker.
  }
}

/** Returns the remembered tags once and forgets them. */
export function takeSignupSource(): SignupSource | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as SignupSource;
    return { source: clean(parsed.source), ref: clean(parsed.ref) };
  } catch {
    return null;
  }
}
