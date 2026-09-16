/**
 * Business identity record (shared, browser-safe).
 *
 * BookedSecure buys every dedicated number itself, so it must be able to say
 * exactly which business is behind each number. This record is that answer:
 * collected from the owner in the app, kept private, and required before a
 * number is issued.
 */

export type BusinessIdentity = {
  legalName: string;
  tradingName: string | null;
  abn: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  website: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  messageTypes: string[];
  declarationAcceptedAt: string | null;
  status: "pending" | "verified";
  verifiedAt: string | null;
  updatedAt: string | null;
};

export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

export const MESSAGE_TYPE_OPTIONS = [
  "Quote replies to people who enquired",
  "Booking confirmations and reminders",
  "Follow-ups to past customers",
  "Service updates and arrival notices",
] as const;

export const IDENTITY_FIELD_LABELS: Record<string, string> = {
  legalName: "Registered business name",
  abn: "ABN",
  addressLine1: "Street address",
  suburb: "Suburb",
  state: "State",
  postcode: "Postcode",
  contactName: "Contact name",
  contactEmail: "Contact email",
  contactPhone: "Contact mobile",
  messageTypes: "Types of messages",
  declaration: "Declaration",
};

export function normaliseAbn(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatAbn(value: string): string {
  const digits = normaliseAbn(value);
  if (digits.length !== 11) return value.trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

export function emptyIdentity(): BusinessIdentity {
  return {
    legalName: "",
    tradingName: null,
    abn: "",
    addressLine1: "",
    addressLine2: null,
    suburb: "",
    state: "",
    postcode: "",
    country: "AU",
    website: null,
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    messageTypes: [],
    declarationAcceptedAt: null,
    status: "pending",
    verifiedAt: null,
    updatedAt: null,
  };
}

/**
 * Returns the field keys still outstanding. An empty list means the record is
 * complete enough to stand behind a number.
 */
export function missingIdentityFields(identity: BusinessIdentity | null): string[] {
  if (!identity) return Object.keys(IDENTITY_FIELD_LABELS);
  const missing: string[] = [];
  if (!identity.legalName.trim()) missing.push("legalName");
  if (normaliseAbn(identity.abn).length !== 11) missing.push("abn");
  if (!identity.addressLine1.trim()) missing.push("addressLine1");
  if (!identity.suburb.trim()) missing.push("suburb");
  if (!identity.state.trim()) missing.push("state");
  if (!/^\d{4}$/.test(identity.postcode.trim())) missing.push("postcode");
  if (!identity.contactName.trim()) missing.push("contactName");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.contactEmail.trim())) missing.push("contactEmail");
  if (normaliseAbn(identity.contactPhone).length < 8) missing.push("contactPhone");
  if (identity.messageTypes.length === 0) missing.push("messageTypes");
  if (!identity.declarationAcceptedAt) missing.push("declaration");
  return missing;
}

export function isIdentityComplete(identity: BusinessIdentity | null): boolean {
  return missingIdentityFields(identity).length === 0;
}

export function describeMissingIdentityFields(missing: string[]): string {
  const labels = missing.map((key) => IDENTITY_FIELD_LABELS[key] ?? key);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
