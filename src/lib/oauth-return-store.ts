import { oauthReturnPath } from "@/lib/oauth-return-path";

/**
 * Where the owner meant to go before a provider (Google / Apple) took the
 * browser away. The provider returns to a plain public callback URL, so the
 * intended destination cannot ride along in that URL — it is kept here for the
 * callback page to pick up once a session exists.
 */
const KEY = "bookedsecure:oauth-return";

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Private mode / blocked storage: sign-in still works, it just lands
    // on the normal destination instead of the page that was requested.
    return null;
  }
}

/** Remember `value` only when it is a same-origin path worth returning to. */
export function rememberOAuthReturn(value: unknown): void {
  const bag = store();
  if (!bag) return;
  const path = oauthReturnPath(value);
  try {
    if (path && path !== "/") bag.setItem(KEY, path);
    else bag.removeItem(KEY);
  } catch {
    // Ignored for the same reason as above.
  }
}

/** Read the saved destination once, clearing it so a back button cannot replay it. */
export function takeOAuthReturn(): string | null {
  const bag = store();
  if (!bag) return null;
  try {
    const raw = bag.getItem(KEY);
    if (!raw) return null;
    bag.removeItem(KEY);
    const path = oauthReturnPath(raw);
    return path && path !== "/" ? path : null;
  } catch {
    return null;
  }
}
