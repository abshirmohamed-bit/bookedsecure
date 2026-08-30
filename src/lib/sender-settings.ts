// Owner-facing sender settings policy.
//
// Live sending infrastructure (number, provider, tenant assignment, active and
// primary flags, routing/credential fields) is platform-managed. The owner save
// path may only touch the display label, and must never silently rewrite an
// existing provider (the old default of "twilio" could downgrade a live Telnyx
// sender). Anything else is rejected rather than applied.

export type ExistingSender = {
  id: string;
  business_id: string | null;
  phone_number: string;
  provider: string;
  active: boolean;
  is_primary: boolean;
  label: string | null;
};

export const PROTECTED_SENDER_FIELDS = [
  "phone_number",
  "provider",
  "business_id",
  "active",
  "is_primary",
  "credential_mode",
  "credential_secret_name",
  "subaccount_sid",
  "messaging_profile_id",
  "status_callback_url",
] as const;

export type SenderLabelRequest = { id: string; label: string | null } & Record<string, unknown>;

export class ProtectedSenderFieldError extends Error {
  constructor(field: string) {
    super(
      `Your dedicated sending number and provider are managed by BookedSecure (${field} cannot be changed here).`,
    );
    this.name = "ProtectedSenderFieldError";
  }
}

/**
 * Returns the only patch an owner may apply to a sender row. Throws when the
 * request carries any protected field, even if the value matches the current
 * row, so nothing can be silently defaulted or rewritten.
 */
export function buildOwnerSenderPatch(
  existing: ExistingSender,
  request: SenderLabelRequest,
): { label: string | null } {
  for (const field of PROTECTED_SENDER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      throw new ProtectedSenderFieldError(field);
    }
  }
  if (request.id !== existing.id) {
    throw new Error("Sender not found for this business.");
  }
  const label = request.label;
  return { label: label === null ? null : String(label).slice(0, 80) };
}
