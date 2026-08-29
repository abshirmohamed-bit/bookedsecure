// Shared validation + attribution helpers for the public pilot application form.
import { z } from "zod";

export const PILOT_STATUSES = ["pending", "accepted", "rejected", "active"] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

export const PILOT_STATUS_LABELS: Record<PilotStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  active: "Active",
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value && value.length > 0 ? value : null));

export const PilotApplicationSchema = z.object({
  business_name: z.string().trim().min(2, "Business name is required").max(120),
  contact_name: z.string().trim().min(2, "Contact name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").max(160),
  phone: z.string().trim().min(6, "Mobile number is required").max(30),
  location: optionalText(120),
  weekly_enquiry_volume: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  services: optionalText(500),
  challenge: optionalText(160),
  utm_source: optionalText(120),
  utm_medium: optionalText(120),
  utm_campaign: optionalText(160),
  utm_term: optionalText(160),
  utm_content: optionalText(160),
  referrer: optionalText(500),
  landing_page: optionalText(300),
  // Honeypot: real applicants never see or fill this field.
  company: optionalText(200),
});

export type PilotApplicationInput = z.infer<typeof PilotApplicationSchema>;

/** Reads UTM/referrer/landing-page attribution from the browser, null when absent. */
export function readAttribution(
  search: string,
  referrer: string | null | undefined,
  pathname: string,
): {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_page: string | null;
} {
  const params = new URLSearchParams(search);
  const read = (key: string) => {
    const value = params.get(key)?.trim();
    return value && value.length > 0 ? value.slice(0, 160) : null;
  };
  const ref = referrer?.trim();
  return {
    utm_source: read("utm_source"),
    utm_medium: read("utm_medium"),
    utm_campaign: read("utm_campaign"),
    utm_term: read("utm_term"),
    utm_content: read("utm_content"),
    referrer: ref && ref.length > 0 ? ref.slice(0, 500) : null,
    landing_page: pathname ? pathname.slice(0, 300) : null,
  };
}
