/**
 * Conversational service-catalogue requests: pure, deterministic, tenant-neutral.
 *
 * Turns one plain-English owner request into a catalogue listing request or a
 * proposed add-on linking change. Nothing here reads or writes data, and no
 * business, service or add-on name is hardcoded: every name is matched against
 * the caller's own approved services and add-ons, supplied by the caller.
 */

export type CatalogListRequest = { kind: "list_catalog" };

export type AddonLinkRequest = {
  kind: "link_addon";
  /** The owner's own words, used to resolve names against their catalogue. */
  text: string;
  /** "for all services" / "every service". */
  allServices: boolean;
  /** True when the owner asked to take the add-on off services instead. */
  remove: boolean;
};

export type CatalogRequest = CatalogListRequest | AddonLinkRequest;

export type NamedRecord = { id: string; name: string };

const CATALOG_NOUN = /\b(services?|add.?ons?|extras?|upgrades?|catalogue|catalog|menu)\b/i;
const LIST_VERB = /\b(list|show|what(?:'s| is| are)?|which|tell me|see|display|give me)\b/i;
const LINK_VERB =
  /\b(connect|link|attach|apply|assign|enable|offer|include|available|add)\b/i;
const REMOVE_VERB =
  /\b(remove|unlink|disconnect|detach|take (?:it )?off|stop offering|no longer)\b/i;
const ALL_SERVICES =
  /\b(?:all|every|each)\b[^.]{0,30}\b(?:services?|of them|of these|of my services?)\b|\bacross all\b|\bfor all\b|\bto all\b|\beverything\b/i;

/** Normalised comparison form that keeps word order, for substring matching. */
export function normaliseCatalogName(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Every catalogue record whose name appears in the owner's words. Longest names
 * are preferred, so "ceramic coating" wins over "coating".
 */
export function findNameMatches<T extends NamedRecord>(
  text: string,
  items: readonly T[],
): T[] {
  const haystack = ` ${normaliseCatalogName(text)} `;
  if (haystack.trim().length === 0) return [];
  return [...items]
    .filter((item) => {
      const name = normaliseCatalogName(item.name);
      return name.length >= 3 && haystack.includes(` ${name} `);
    })
    .sort((a, b) => b.name.length - a.name.length);
}

/** The single add-on the owner most likely meant, or null when unclear. */
export function pickAddon<T extends NamedRecord>(
  text: string,
  addons: readonly T[],
): T | null {
  return findNameMatches(text, addons)[0] ?? null;
}

/**
 * Parses one owner request. Returns null when the request is not about the
 * service catalogue, so the read-only assistant answers it as before.
 */
export function parseCatalogRequest(question: string): CatalogRequest | null {
  const text = (question ?? "").trim();
  if (text.length === 0) return null;

  const remove = REMOVE_VERB.test(text);
  const linking = remove || LINK_VERB.test(text) || /\bmake\b/i.test(text);
  const mentionsCatalogue = CATALOG_NOUN.test(text);

  // A listing question never changes anything, so it wins when no link verb is used.
  if (mentionsCatalogue && LIST_VERB.test(text) && !remove && !/\b(connect|link|attach|assign)\b/i.test(text)) {
    return { kind: "list_catalog" };
  }

  if (linking && mentionsCatalogue) {
    return { kind: "link_addon", text, allServices: ALL_SERVICES.test(text), remove };
  }

  return null;
}

function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "none";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plain-language listing of the tenant's own catalogue. */
export function renderCatalogList(input: {
  services: readonly NamedRecord[];
  addons: ReadonlyArray<NamedRecord & { serviceIds: readonly string[] }>;
}): string {
  const lines: string[] = [];
  lines.push(
    input.services.length === 0
      ? "You have no approved services yet."
      : `Approved services (${input.services.length}): ${joinNames(input.services.map((s) => s.name))}.`,
  );
  if (input.addons.length === 0) {
    lines.push("You have no add-ons yet.");
  } else {
    const byId = new Map(input.services.map((service) => [service.id, service.name]));
    lines.push(`Add-ons (${input.addons.length}):`);
    for (const addon of input.addons) {
      const linked = addon.serviceIds
        .map((id) => byId.get(id))
        .filter((name): name is string => Boolean(name));
      const scope =
        linked.length === 0
          ? "not linked to any service yet"
          : linked.length === input.services.length && input.services.length > 0
            ? "available with all services"
            : `available with ${joinNames(linked)}`;
      lines.push(`- ${addon.name}: ${scope}.`);
    }
  }
  return lines.join("\n");
}

/** One line describing the linking change, for the owner to confirm. */
export function describeAddonLinkChange(input: {
  addonName: string;
  serviceNames: readonly string[];
  remove: boolean;
  allServices: boolean;
}): string {
  const scope = input.allServices
    ? `all ${input.serviceNames.length} of your approved services`
    : joinNames(input.serviceNames);
  return input.remove
    ? `Remove "${input.addonName}" from ${scope}.`
    : `Offer "${input.addonName}" with ${scope}.`;
}
