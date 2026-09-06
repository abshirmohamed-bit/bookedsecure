/**
 * Owner notification number policy (pure, no I/O).
 *
 * This is the destination number for internal owner alerts only. It is a
 * separate concept from:
 *  - the tenant's assigned SMS sending line (the FROM number), and
 *  - the public business callback number shown to customers.
 *
 * Only Australian mobile numbers are accepted: landlines cannot receive the
 * owner alert reliably, so they are rejected rather than stored.
 */

export type OwnerPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: string };

const AU_MOBILE_E164 = /^\+614\d{8}$/;

/**
 * Accepts +61 447 852 565, 0447 852 565 and 0447852565 (any spacing or
 * separators) and normalises to E.164 (+61447852565). Everything else,
 * including landlines and incomplete numbers, is rejected.
 */
export function normaliseOwnerNotificationNumber(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;
  let candidate: string | null = null;
  if (/^\+61\d{9}$/.test(digits)) candidate = digits;
  else if (/^61\d{9}$/.test(digits)) candidate = `+${digits}`;
  else if (/^0\d{9}$/.test(digits)) candidate = `+61${digits.slice(1)}`;
  if (!candidate) return null;
  return AU_MOBILE_E164.test(candidate) ? candidate : null;
}

/** Validation with an owner-facing reason, used by the settings save path. */
export function validateOwnerNotificationNumber(input: string | null | undefined): OwnerPhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "Enter a mobile number, or clear the field to turn owner alerts off." };
  const normalised = normaliseOwnerNotificationNumber(raw);
  if (!normalised) {
    return {
      ok: false,
      reason:
        "That is not a valid Australian mobile number. Use a format like 0447 852 565 or +61 447 852 565.",
    };
  }
  return { ok: true, e164: normalised };
}

/** True when the value is a storable owner notification number. */
export function isValidOwnerNotificationNumber(input: string | null | undefined): boolean {
  return normaliseOwnerNotificationNumber(input) !== null;
}

/** Display form for owner-facing screens: last three digits only. */
export function maskOwnerNotificationNumber(input: string | null | undefined): string {
  const normalised = normaliseOwnerNotificationNumber(input);
  if (!normalised) return "Not set";
  return `+61 4•• ••• ${normalised.slice(-3)}`;
}

/** Readable grouped form, used only in authorised owner settings screens. */
export function formatOwnerNotificationNumber(input: string | null | undefined): string {
  const normalised = normaliseOwnerNotificationNumber(input);
  if (!normalised) return "";
  const national = normalised.slice(3); // 4XXXXXXXX
  return `+61 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}
