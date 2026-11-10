// A password-reset link opens /reset-password with its instructions in the URL.
// Supabase's implicit flow puts them in the hash (#type=recovery&access_token=...);
// a PKCE flow would instead hand back a one-time code in the query. Both mean the
// same thing here: this visit came from a reset link, so a new password may be set.

export type RecoveryLink = "recovery" | "code" | "none";

export function readRecoveryLink(hash: string): RecoveryLink {
  const params = new URLSearchParams(hash.replace(/^[#?]+/, ""));
  if (params.get("type") === "recovery") return "recovery";
  if (params.get("code")) return "code";
  return "none";
}
