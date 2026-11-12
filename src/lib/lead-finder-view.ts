/** Lead finder results on screen: filters, ordering and the CSV export. Pure, so it is tested without a browser. */

export type ViewResult = {
  name: string; category: string | null; suburb: string | null; address: string | null; phone: string | null; website: string | null;
  summary: string | null; email: string | null; emailStatus: string; fit: "good" | "maybe" | "no" | "unknown"; fitReason: string | null;
  status: string; contactName?: string | null; contactRole?: string | null; sizeHint?: string | null;
};

export type ResultFilter = "all" | "good" | "email" | "phone" | "unknown";
export type ResultSort = "best" | "contact" | "name";

export const RESULT_FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "good", label: "Good fit" },
  { id: "email", label: "Has email" },
  { id: "phone", label: "Has phone" },
  { id: "unknown", label: "Not checked" },
];

const FIT_ORDER = { good: 0, maybe: 1, unknown: 2, no: 3 } as const;
/** How reachable a business is: an email and a named person beat a phone alone. */
const reach = (r: ViewResult) => (r.email ? 4 : 0) + (r.contactName ? 2 : 0) + (r.phone ? 1 : 0);

export function filterResults<T extends ViewResult>(results: T[], filter: ResultFilter, sort: ResultSort): T[] {
  const kept = results.filter((r) =>
    filter === "good" ? r.fit === "good"
      : filter === "email" ? Boolean(r.email)
        : filter === "phone" ? Boolean(r.phone)
          : filter === "unknown" ? r.fit === "unknown"
            : true);
  return [...kept].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name)
      : sort === "contact" ? reach(b) - reach(a) || FIT_ORDER[a.fit] - FIT_ORDER[b.fit]
        : FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || reach(b) - reach(a));
}

const FIT_TEXT = { good: "Good fit", maybe: "Maybe", no: "Not a fit", unknown: "Not checked" } as const;

/** One cell, quoted, with spreadsheet formulas neutralised (a cell starting = + - @ is text, not a formula). */
function cell(value: string | null | undefined): string {
  let v = (value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function csvForResults(results: ViewResult[]): string {
  const head = ["Business", "Fit", "Why", "Contact", "Role", "Size", "Email", "Email check", "Phone", "Website", "Suburb", "Address", "Category", "What they do", "Status"];
  const rows = results.map((r) => [
    r.name, FIT_TEXT[r.fit], r.fitReason, r.contactName ?? null, r.contactRole ?? null, r.sizeHint ?? null, r.email, r.email ? r.emailStatus : null,
    r.phone, r.website, r.suburb, r.address, r.category, r.summary, r.status,
  ].map(cell).join(","));
  // The BOM makes Excel read it as UTF-8.
  return `${String.fromCharCode(0xfeff)}${[head.map(cell).join(","), ...rows].join("\r\n")}\r\n`;
}
