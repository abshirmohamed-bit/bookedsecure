// The live quote acknowledgement is a frozen contract. A stored, editable
// automation rule must never silently change it, so the stored template is used
// only when it matches the frozen contract exactly.

export const ACKNOWLEDGEMENT_TEMPLATE =
  "Hi {{first_name}}, thanks for contacting {{business_name}}. We've received your detailing enquiry. Reply with your vehicle type and main concern so we can help. Reply STOP to opt out.";

const PHOTO_PATTERN = /\bphoto|\bpic(?:ture)?s?\b|\bimage\b/i;

export function requestsPhoto(text: string): boolean {
  return PHOTO_PATTERN.test(text);
}

/**
 * Returns the template to send plus whether the stored rule was overridden.
 * Enforcement only: it never edits stored data and never changes activation.
 */
export function resolveAcknowledgementTemplate(stored: string | null | undefined): {
  template: string;
  enforced: boolean;
} {
  const candidate = typeof stored === "string" ? stored.trim() : "";
  if (candidate === ACKNOWLEDGEMENT_TEMPLATE) return { template: candidate, enforced: false };
  return { template: ACKNOWLEDGEMENT_TEMPLATE, enforced: candidate.length > 0 };
}
