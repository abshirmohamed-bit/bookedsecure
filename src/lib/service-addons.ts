/**
 * Add-on services: pure layer.
 *
 * An add-on is an extra a tenant sells on top of one of their approved
 * services ("pet hair removal", "engine bay clean"). Rules that must hold:
 *
 * - An add-on is always tenant-owned and always linked to at least one of that
 *   tenant's own approved services. It is never a standalone bookable service.
 * - Pricing is only ever the tenant's own wording, shown verbatim. Nothing here
 *   totals, discounts or invents a figure.
 * - Tenant-neutral by construction: no business, service or price is hardcoded.
 */

import { serviceMatchKey } from "@/lib/site-onboarding";

export type ServiceAddon = {
  id: string;
  name: string;
  /** The tenant's own grouping heading for this extra, or null. */
  category?: string | null;
  description?: string | null;
  price_guidance?: string | null;
  /** Public picture address for this extra, or null. */
  image_url?: string | null;
  duration_minutes?: number | null;
  active?: boolean | null;
  /** Approved services this add-on may be offered with. */
  serviceIds: string[];
};

export const NO_ADDONS_CHOICE = "__no_addons__";

const clean = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > 0 ? text : null;
};

/** Add-ons a tenant offers with one particular approved service. */
export function addonsForService(
  addons: readonly ServiceAddon[],
  serviceId: string | null | undefined,
): ServiceAddon[] {
  if (!serviceId) return [];
  return addons.filter(
    (addon) => addon.active !== false && addon.serviceIds.includes(serviceId),
  );
}

/** Customer-facing one-liner for an add-on. Price is the tenant's own text. */
export function addonDetail(addon: ServiceAddon): string | null {
  const parts = [clean(addon.price_guidance), clean(addon.description)].filter(
    Boolean,
  ) as string[];
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Comparison key so the same extra is never stored twice under different wording. */
export function addonMatchKey(name: string): string {
  return serviceMatchKey(name);
}

export function isSameAddon(left: string, right: string): boolean {
  return addonMatchKey(left) === addonMatchKey(right);
}

/** True when the customer's words mean "no extras". */
export function declinesAddons(value: string): boolean {
  return /^(no|nope|nah|none|nothing|no thanks?|no extras?|that'?s all|thats all|that'?s it|skip|all good|i'?m good|im good|just the service)\b/i.test(
    value.trim(),
  );
}

/**
 * Deterministic match from what the customer typed or tapped onto the add-ons
 * actually offered. Only the tenant's own linked add-ons can ever be selected;
 * unmatched words select nothing.
 */
export function matchAddons(
  value: string,
  offered: readonly ServiceAddon[],
): ServiceAddon[] {
  const said = value.trim();
  if (!said || offered.length === 0) return [];

  const byId = offered.filter((addon) => addon.id === said);
  if (byId.length > 0) return byId;

  const norm = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(said);
  if (target.length < 3) return [];

  const matched: ServiceAddon[] = [];
  for (const addon of offered) {
    const name = norm(addon.name);
    if (name.length < 3) continue;
    if (target === name || target.includes(name) || name.includes(target)) matched.push(addon);
  }
  if (matched.length > 0) return matched;

  // "pet hair and engine bay": each clause is matched on its own.
  for (const clause of said.split(/,|\band\b|\+|&/i)) {
    const part = norm(clause);
    if (part.length < 3) continue;
    for (const addon of offered) {
      const name = norm(addon.name);
      if (name.length < 3 || matched.includes(addon)) continue;
      if (part === name || part.includes(name) || name.includes(part)) matched.push(addon);
    }
  }
  return matched;
}

/** Prompt shown when extras are available for the chosen service. */
export function addonsPromptText(
  offered: readonly ServiceAddon[],
  alreadyChosen: readonly string[],
): string {
  if (alreadyChosen.length > 0) {
    return "Added. Anything else you'd like with it, or type an extra we haven't listed, or say no extras.";
  }
  const names = offered.map((addon) => addon.name);
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `Would you like any extras with that. ${list}? If what you want isn't there, type it in, or say no extras.`;
}

/** Plain-language summary for the owner alert and the booking summary. */
export function addonsSummary(names: readonly string[]): string | null {
  const kept = names.map((name) => clean(name)).filter(Boolean) as string[];
  return kept.length > 0 ? kept.join(", ") : null;
}
