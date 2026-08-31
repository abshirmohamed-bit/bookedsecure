import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { MetricTile, ToneBadge } from "@/components/import/MetricTile";
import { formatUploadTimestamp } from "@/lib/import-history";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_LABELS,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_PREVIEW_SIZE,
  activityClipboardText,
  activityCounts,
  activityOutcomeTone,
  activityPage,
  activityResultText,
  filterActivity,
  type ActivityFilter,
} from "@/lib/import-presentation";
import { ROW_OUTCOME_LABELS, type RowOutcome, type RowResult } from "@/lib/import-automation";

/**
 * Compact, contained view of the per-row import activity. Presentation only:
 * the full activity data stays available, nothing is re-imported or changed.
 */
export function ImportActivityPanel({
  rows,
  ranAt,
}: {
  rows: readonly RowResult[];
  ranAt: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const counts = useMemo(() => activityCounts(rows), [rows]);
  const filtered = useMemo(() => filterActivity(rows, filter, query), [rows, filter, query]);
  const paged = activityPage(filtered, page);
  const timestamp = ranAt ? formatUploadTimestamp(ranAt) : null;

  const copyActivity = async () => {
    try {
      await navigator.clipboard.writeText(activityClipboardText(rows, ranAt));
      toast.success("Activity copied to the clipboard.");
    } catch {
      toast.error("Could not copy the activity list.");
    }
  };

  if (rows.length === 0) {
    return (
      <section id="import-activity" className="panel p-4" aria-label="Import activity">
        <h2 className="text-sm font-semibold">Import activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">No per-row activity recorded yet.</p>
      </section>
    );
  }

  return (
    <section id="import-activity" className="panel space-y-3 p-4" aria-label="Import activity">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Read-only · no live data will change
        </p>
        <h2 className="mt-1 text-sm font-semibold">Import activity</h2>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Total events" value={counts.all} />
        <MetricTile label="Auto-imported" value={counts.auto_imported} />
        <MetricTile label="Manually imported" value={counts.manually_imported} />
        <MetricTile label="Already committed" value={counts.already_committed} />
        <MetricTile
          label="Failed"
          value={counts.failed}
          tone={counts.failed > 0 ? "bad" : "good"}
        />
        <MetricTile
          label="Pending"
          value={counts.pending}
          tone={counts.pending > 0 ? "warn" : "good"}
        />
      </dl>

      {!expanded ? (
        <ul className="space-y-1 text-xs">
          {rows.slice(0, ACTIVITY_PREVIEW_SIZE).map((row) => (
            <li key={row.row_number} className="flex min-w-0 items-center gap-2">
              <ToneBadge tone={activityOutcomeTone(row.outcome as RowOutcome)}>
                Row {row.row_number}
              </ToneBadge>
              <span className="truncate text-muted-foreground">{activityResultText(row)}</span>
            </li>
          ))}
          {rows.length > ACTIVITY_PREVIEW_SIZE ? (
            <li className="text-[11px] text-muted-foreground">
              Showing the first {ACTIVITY_PREVIEW_SIZE} of {rows.length} events.
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? "Collapse activity" : "View all activity"}
        </button>
        <button
          type="button"
          onClick={() => void copyActivity()}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Copy activity
        </button>
        <label htmlFor="activity-filter" className="text-xs text-muted-foreground">
          Status
        </label>
        <select
          id="activity-filter"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as ActivityFilter);
            setPage(1);
          }}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {ACTIVITY_FILTERS.map((option) => (
            <option key={option} value={option}>
              {ACTIVITY_FILTER_LABELS[option]} ({counts[option]})
            </option>
          ))}
        </select>
        <label htmlFor="activity-search" className="text-xs text-muted-foreground">
          Row
        </label>
        <input
          id="activity-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          inputMode="numeric"
          placeholder="e.g. 12"
          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      {expanded ? (
        <>
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Result</th>
                  <th className="px-2 py-2">Timestamp</th>
                  <th className="px-2 py-2">Lead</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((row) => (
                  <tr key={row.row_number} className="border-t border-border align-top">
                    <td className="px-2 py-2 tabular">{row.row_number}</td>
                    <td className="px-2 py-2">
                      <ToneBadge tone={activityOutcomeTone(row.outcome as RowOutcome)}>
                        {ROW_OUTCOME_LABELS[row.outcome as RowOutcome] ?? row.outcome}
                      </ToneBadge>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{activityResultText(row)}</td>
                    <td className="px-2 py-2 text-muted-foreground">{timestamp ?? "—"}</td>
                    <td className="px-2 py-2">
                      {row.lead_id ? (
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: row.lead_id }}
                          className="underline hover:no-underline"
                        >
                          Open lead
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {paged.rows.length} of {filtered.length} matching events · page {paged.page}{" "}
              of {paged.pageCount}
            </span>
            {filtered.length > ACTIVITY_PAGE_SIZE ? (
              <>
                <button
                  type="button"
                  disabled={paged.page <= 1}
                  onClick={() => setPage(paged.page - 1)}
                  className="rounded-md border border-input px-2 py-1 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={paged.page >= paged.pageCount}
                  onClick={() => setPage(paged.page + 1)}
                  className="rounded-md border border-input px-2 py-1 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Next
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
