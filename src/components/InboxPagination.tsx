import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS, type PageMeta } from "@/lib/lead-pagination";

/** Shared Previous / Next / page-size controls for tenant-scoped paginated lists. */
export function InboxPagination({
  page,
  isLoading,
  onPageChange,
  onPageSizeChange,
  label = "leads",
}: {
  page: PageMeta | null;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  label?: string;
}) {
  if (!page) return null;
  const pageCount = Math.max(page.pageCount, 1);

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs"
    >
      <p className="text-muted-foreground" data-testid="pagination-summary">
        {page.totalCount === 0
          ? `No ${label} match these filters`
          : `Showing ${page.rangeFrom}–${page.rangeTo} of ${page.totalCount} ${label}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <span className="sr-only">Rows per page</span>
            <select
              aria-label="Rows per page"
              value={page.pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => onPageChange(page.page - 1)}
          disabled={!page.hasPreviousPage || isLoading}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
        </button>
        <span className="text-muted-foreground" data-testid="pagination-position">
          Page {page.page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page.page + 1)}
          disabled={!page.hasNextPage || isLoading}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
