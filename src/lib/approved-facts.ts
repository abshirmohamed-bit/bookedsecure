// Phase 2: the approved-facts allow-list.
//
// approvedFacts is a deliberately narrow, tenant-scoped structure. It is the
// ONLY source the model (and guardReply) may use for pricing language. General
// Business Settings context stays separate and is never a pricing source.
//
// Nothing here fabricates a value: a missing, inactive, ambiguous or
// price-less service yields no approved price and a human-review reason.

export type ApprovedServiceRecord = {
  id: string;
  business_id?: string | null;
  name: string;
  description?: string | null;
  included_items?: string | null;
  excluded_items?: string | null;
  qualification_note?: string | null;
  price_guidance?: string | null;
  active?: boolean | null;
};

export type ApprovedFactsLead = {
  business_id?: string | null;
  approved_service_id?: string | null;
  service_name_snapshot?: string | null;
  request_type?: string | null;
  requires_owner_review?: boolean | null;
};

export type ApprovedFactsReason =
  | "approved"
  | "no_price_guidance"
  | "no_service_selected"
  | "service_unavailable"
  | "ambiguous_service"
  | "owner_review_required";

export type ApprovedFacts = {
  /** Tenant the facts belong to. traceability and isolation. */
  businessId: string;
  /** Source service, for traceability. Null when nothing is approved. */
  serviceId: string | null;
  serviceName: string | null;
  description: string | null;
  includedItems: string | null;
  excludedItems: string | null;
  qualificationNote: string | null;
  /** Exact current price_guidance, or null. Never invented, never derived. */
  priceGuidance: string | null;
  /** True when the requested service cannot be resolved to exactly one service. */
  ambiguous: boolean;
  reason: ApprovedFactsReason;
  /** Always true in this phase: drafts are owner-approved only. */
  needsHumanReview: true;
};

const text = (value: unknown): string | null => {
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0 ? t : null;
};

function empty(
  businessId: string,
  reason: ApprovedFactsReason,
  ambiguous = false,
): ApprovedFacts {
  return {
    businessId,
    serviceId: null,
    serviceName: null,
    description: null,
    includedItems: null,
    excludedItems: null,
    qualificationNote: null,
    priceGuidance: null,
    ambiguous,
    reason,
    needsHumanReview: true,
  };
}

/**
 * Builds the allow-list from the current tenant's active services plus the
 * lead's own service snapshot. Inactive services, other tenants' services and
 * flexible/owner-review requests never produce approved pricing.
 */
export function buildApprovedFacts(input: {
  businessId: string;
  lead: ApprovedFactsLead;
  services: ApprovedServiceRecord[];
}): ApprovedFacts {
  const { businessId, lead } = input;

  // Tenant scoping and active-only filtering happen here, not at call sites.
  const candidates = input.services.filter(
    (service) =>
      service.active !== false &&
      (service.business_id == null || service.business_id === businessId) &&
      Boolean(text(service.name)),
  );

  if (lead.business_id != null && lead.business_id !== businessId) {
    return empty(businessId, "service_unavailable");
  }
  if (lead.requires_owner_review === true) {
    return empty(businessId, "owner_review_required", true);
  }

  const byId = lead.approved_service_id
    ? candidates.find((service) => service.id === lead.approved_service_id)
    : undefined;

  let selected = byId;
  if (!selected) {
    const snapshot = text(lead.service_name_snapshot);
    if (!snapshot) {
      return empty(
        businessId,
        lead.approved_service_id ? "service_unavailable" : "no_service_selected",
      );
    }
    const matches = candidates.filter(
      (service) => (text(service.name) ?? "").toLowerCase() === snapshot.toLowerCase(),
    );
    if (matches.length === 0) return empty(businessId, "service_unavailable");
    if (matches.length > 1) return empty(businessId, "ambiguous_service", true);
    selected = matches[0];
  }

  const service = selected!;
  const price = text(service.price_guidance);
  return {
    businessId,
    serviceId: service.id,
    serviceName: text(service.name),
    description: text(service.description),
    includedItems: text(service.included_items),
    excludedItems: text(service.excluded_items),
    qualificationNote: text(service.qualification_note),
    priceGuidance: price,
    ambiguous: false,
    reason: price ? "approved" : "no_price_guidance",
    needsHumanReview: true,
  };
}

/** True when the facts may be used as the source of pricing language. */
export function hasApprovedPrice(facts: ApprovedFacts | null | undefined): boolean {
  return Boolean(facts && !facts.ambiguous && facts.reason === "approved" && facts.priceGuidance);
}

/** Prompt block for the allow-list. Kept separate from general context. */
export function buildApprovedFactsContext(facts: ApprovedFacts | null | undefined): string {
  if (!facts || !facts.serviceName) {
    return [
      "Approved facts (allow-list). NONE.",
      "- No approved service or price guidance is available for this lead.",
      "- You must not state, imply, estimate or derive any price. Ask a neutral clarifying question and say the owner will confirm.",
    ].join("\n");
  }
  const lines = [
    "Approved facts (allow-list). the ONLY source you may use for pricing language:",
    `- Approved service name (exact): ${facts.serviceName}`,
  ];
  if (facts.description) lines.push(`- Description: ${facts.description}`);
  if (facts.includedItems) lines.push(`- Includes: ${facts.includedItems}`);
  if (facts.excludedItems) lines.push(`- Excludes: ${facts.excludedItems}`);
  if (facts.qualificationNote) lines.push(`- Qualification note: ${facts.qualificationNote}`);
  if (hasApprovedPrice(facts)) {
    lines.push(
      `- Approved price guidance (exact text, quote verbatim or not at all): ${facts.priceGuidance}`,
      "- You may repeat that exact approved guidance. You must not narrow a range, pick a value, calculate, total, add fees, tax, deposits or discounts, or call it a final or guaranteed price.",
    );
  } else {
    lines.push(
      "- No approved price guidance. Do not state or imply any price; say the owner will confirm pricing.",
    );
  }
  lines.push(
    "- General Business Settings are operational context only and are never a source of pricing.",
  );
  return lines.join("\n");
}
