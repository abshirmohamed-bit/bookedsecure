// Pure assembly of the tenant's Business Settings into AI context facts.
// Everything here comes from persisted settings for one business_id: no
// hard-coded tenant values, no fabricated defaults for missing settings.

export type BusinessFactsInput = {
  name: string;
  service_area?: string | null;
  timezone?: string | null;
  opening_hours?: string | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  sms_signature?: string | null;
  privacy_policy_url?: string | null;
};

export type ServiceFactsInput = {
  name: string;
  description?: string | null;
  price_guidance?: string | null;
  included_items?: string | null;
  excluded_items?: string | null;
  qualification_note?: string | null;
};

/** Omits any setting the tenant has not filled in — never substitutes a value. */
export function buildBusinessFacts(business: BusinessFactsInput): string[] {
  const facts: string[] = [`Business name: ${business.name}`];
  const push = (label: string, value: string | null | undefined) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) facts.push(`${label}: ${text}`);
  };
  push("Service area", business.service_area);
  push("Timezone", business.timezone);
  push("Opening hours", business.opening_hours);
  if (
    typeof business.quiet_hours_start === "number" &&
    typeof business.quiet_hours_end === "number"
  ) {
    facts.push(
      `Quiet hours (no messages sent): ${business.quiet_hours_start}:00 to ${business.quiet_hours_end}:00 local time`,
    );
  }
  push("Message signature", business.sms_signature);
  push("Privacy policy", business.privacy_policy_url);
  return facts;
}

/** Approved catalogue lines. Price guidance is context only — never quotable. */
export function buildServiceFacts(services: ServiceFactsInput[]): string[] {
  return services.map((service) => {
    const parts = [`- ${service.name}`];
    const add = (label: string, value: string | null | undefined) => {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) parts.push(`${label}: ${text}`);
    };
    add("Description", service.description);
    add("Includes", service.included_items);
    add("Excludes", service.excluded_items);
    add("Qualification note", service.qualification_note);
    add("Price guidance (internal context only, never quote it)", service.price_guidance);
    return parts.join(" | ");
  });
}

/** The full Business Settings block handed to the model for this tenant. */
export function buildBusinessSettingsContext(
  business: BusinessFactsInput,
  services: ServiceFactsInput[],
): string {
  const catalogue = buildServiceFacts(services);
  return [
    "Business Settings (authoritative, current values for this business):",
    ...buildBusinessFacts(business).map((fact) => `- ${fact}`),
    "Approved service catalogue:",
    ...(catalogue.length > 0 ? catalogue : ["- No services configured yet."]),
  ].join("\n");
}
