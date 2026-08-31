import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MetricTile, ToneBadge } from "@/components/import/MetricTile";
import { formatUploadTimestamp } from "@/lib/import-history";
import {
  buildSummaryGroups,
  sideEffectsClean,
  summaryHeadline,
  type SummaryGroup,
} from "@/lib/import-presentation";
import type { ImportSummary } from "@/lib/import-automation";

/**
 * Compact, grouped view of the durable last-import summary.
 * Read-only: no metric is hidden, nothing here can trigger an import.
 */
export function ImportSummarySection({
  summary,
  ranAt,
}: {
  summary: ImportSummary | null;
  ranAt: string | null;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!summary) {
    return (
      <section id="import-summary" className="panel p-4" aria-label="Last import summary">
        <h2 className="text-sm font-semibold">Latest import outcome</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          No import has run for this business yet.
        </p>
      </section>
    );
  }

  const groups = buildSummaryGroups(summary);
  const clean = sideEffectsClean(summary);
  const headline: SummaryGroup[] = groups;

  return (
    <section id="import-summary" className="panel space-y-3 p-4" aria-label="Last import summary">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Read-only · no live data will change
          </p>
          <h2 className="mt-1 truncate text-sm font-semibold">
            {summaryHeadline(summary)}
            {ranAt ? ` · ${formatUploadTimestamp(ranAt)}` : ""}
          </h2>
        </div>
        <ToneBadge tone={clean ? "good" : "bad"}>
          {clean ? "Zero side effects" : "Side effects detected"}
        </ToneBadge>
      </div>

      {headline.map((group) => (
        <div key={group.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-xs font-semibold">{group.title}</h3>
            <p className="text-[11px] text-muted-foreground">{group.hint}</p>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {group.metrics.slice(0, showAll ? group.metrics.length : 4).map((metric) => (
              <MetricTile
                key={metric.label}
                label={metric.label}
                value={metric.value}
                tone={metric.tone}
              />
            ))}
          </dl>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setShowAll((value) => !value)}
        aria-expanded={showAll}
        className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {showAll ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {showAll ? "Hide full metrics" : "Full metrics"}
      </button>
    </section>
  );
}
