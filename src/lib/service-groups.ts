/**
 * Service grouping: pure layer.
 *
 * Tenants list their services under their own headings ("Interior",
 * "Interior + Exterior", "Paint", "Premium", "Maintenance"). That heading is
 * the tenant's own wording, read from their website or typed by them. nothing
 * here invents, translates or hardcodes a group name.
 *
 * A service with no heading is shown under OTHER_GROUP so nothing is ever
 * hidden from the customer or the owner.
 */

export const OTHER_GROUP = "Other";

/** Tenant-entered group label, tidied for display. Null when not usable. */
export function normaliseGroupLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 40) return text.length >= 2 ? text.slice(0, 40) : null;
  return text;
}

/** Display label for one item: its own group, or "Other". */
export function groupLabelFor(value: unknown): string {
  return normaliseGroupLabel(value) ?? OTHER_GROUP;
}

/** Case-insensitive key so "Interior" and "interior" are one group. */
function groupKey(label: string): string {
  return label.toLowerCase();
}

export type ItemGroup<T> = { label: string; items: T[] };

/**
 * Groups items by their tenant-entered category, keeping the order the items
 * arrived in (which mirrors the tenant's own list) and always placing "Other"
 * last. Every item appears in exactly one group.
 */
export function groupItems<T>(
  items: readonly T[],
  category: (item: T) => string | null | undefined,
): ItemGroup<T>[] {
  const groups: ItemGroup<T>[] = [];
  const index = new Map<string, ItemGroup<T>>();
  for (const item of items) {
    const label = groupLabelFor(category(item));
    const key = groupKey(label);
    let group = index.get(key);
    if (!group) {
      group = { label, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  const other = groups.filter((group) => groupKey(group.label) === groupKey(OTHER_GROUP));
  const named = groups.filter((group) => groupKey(group.label) !== groupKey(OTHER_GROUP));
  return [...named, ...other];
}

/** True when grouping adds anything: more than one group is actually present. */
export function hasMeaningfulGroups(groups: readonly ItemGroup<unknown>[]): boolean {
  return groups.length > 1;
}

/** "1 hr 30 min" style length for a duration in minutes. Null stays null. */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (!Number.isFinite(minutes) || Number(minutes) <= 0) return null;
  const total = Math.round(Number(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return hours === 1 ? "1 hr" : `${hours} hrs`;
  return `${hours} hr ${rest} min`;
}
