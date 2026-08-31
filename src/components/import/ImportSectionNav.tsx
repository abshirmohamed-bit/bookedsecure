import { EXCEPTION_ANCHOR_ID } from "@/lib/import-lite";

/** Section jump links for the Advanced import view. Navigation only. */
export const IMPORT_SECTIONS: { id: string; label: string }[] = [
  { id: "import-rollout", label: "Import rollout" },
  { id: "import-upload", label: "Upload CSV" },
  { id: "import-recent", label: "Recent uploads" },
  { id: "import-summary", label: "Import summary" },
  { id: "import-activity", label: "Activity" },
  { id: "import-repair", label: "Phone repair" },
  { id: "import-dry-run", label: "Dry-run summary" },
  { id: "import-simulation", label: "Commit simulation" },
  { id: "canary-result", label: "Canary result" },
  { id: EXCEPTION_ANCHOR_ID, label: "Staged rows" },
];

export function ImportSectionNav() {
  return (
    <nav
      aria-label="Import sections"
      className="sticky top-0 z-20 -mx-1 border-b border-border bg-background/95 px-1 py-2 backdrop-blur"
    >
      <ul className="flex snap-x gap-1.5 overflow-x-auto">
        {IMPORT_SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0 snap-start">
            <a
              href={`#${section.id}`}
              className="inline-flex rounded-md border border-input px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
