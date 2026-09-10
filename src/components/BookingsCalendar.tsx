import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Phone, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getBookings } from "@/lib/bookings.functions";
import {
  bookingStateText,
  customerLabel,
  dayKey,
  groupByDay,
  longDateLabel,
  monthGrid,
  monthLabel,
  shiftMonth,
  timeLabel,
  upcomingBookings,
  visibleNotes,
  WEEKDAY_LABELS,
  type BookingEntry,
} from "@/lib/bookings";

function stateClasses(state: BookingEntry["state"]): string {
  if (state === "completed") return "bg-primary/10 text-primary";
  if (state === "cancelled") return "bg-muted text-muted-foreground line-through";
  return "bg-accent/15 text-accent-foreground";
}

function money(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function BookingsCalendar() {
  const fetchBookings = useServerFn(getBookings);
  const { data, isLoading, error } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => fetchBookings(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), monthIndex: today.getMonth() });
  const [selected, setSelected] = useState<BookingEntry | null>(null);

  const timezone = data?.timezone ?? null;
  const bookings = data?.bookings ?? [];
  const byDay = useMemo(() => groupByDay(bookings, timezone), [bookings, timezone]);
  const next = useMemo(
    () => upcomingBookings(bookings, data?.now ?? new Date().toISOString()).slice(0, 8),
    [bookings, data?.now],
  );
  const cells = useMemo(() => monthGrid(view.year, view.monthIndex), [view]);
  const todayKey = dayKey(new Date().toISOString(), timezone);

  if (isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading bookings…</p>;
  }
  if (error) {
    return <p className="py-16 text-center text-sm text-destructive">Bookings could not be loaded.</p>;
  }

  return (
    <div className="w-full min-w-0 space-y-6 overflow-x-hidden">
      <section className="rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h2 className="font-heading text-sm font-semibold">Next up</h2>
          <span className="text-xs text-muted-foreground">{next.length} upcoming</span>
        </div>
        {next.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming bookings yet. Confirmed bookings appear here automatically.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {next.map((entry) => (
              <li key={entry.jobId}>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="min-h-14 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-secondary"
                >
                  <p className="truncate text-sm font-semibold">{customerLabel(entry.customerName)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.scheduledAt
                      ? `${longDateLabel(entry.scheduledAt, timezone)} · ${timeLabel(entry.scheduledAt, timezone)}`
                      : "No time set"}
                    {entry.serviceName ? ` · ${entry.serviceName}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <h2 className="truncate font-heading text-sm font-semibold">
              {monthLabel(view.year, view.monthIndex)}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-10"
              aria-label="Previous month"
              onClick={() => setView((current) => shiftMonth(current.year, current.monthIndex, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={() => setView({ year: today.getFullYear(), monthIndex: today.getMonth() })}
            >
              Today
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-10"
              aria-label="Next month"
              onClick={() => setView((current) => shiftMonth(current.year, current.monthIndex, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop and tablet: month grid. */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAY_LABELS.map((label) => (
              <p key={label} className="text-center text-[11px] font-medium text-muted-foreground">
                {label}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const entries = byDay.get(cell.key) ?? [];
              return (
                <div
                  key={cell.key}
                  className={`min-h-24 min-w-0 rounded-lg border p-1.5 ${
                    cell.key === todayKey
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/70 bg-background"
                  } ${cell.inMonth ? "" : "opacity-50"}`}
                >
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{cell.day}</p>
                  <div className="space-y-1">
                    {entries.slice(0, 3).map((entry) => (
                      <button
                        key={entry.jobId}
                        type="button"
                        onClick={() => setSelected(entry)}
                        className={`block w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] font-medium ${stateClasses(entry.state)}`}
                        title={`${customerLabel(entry.customerName)} · ${entry.serviceName ?? "Service to confirm"}`}
                      >
                        {entry.scheduledAt ? `${timeLabel(entry.scheduledAt, timezone)} ` : ""}
                        {customerLabel(entry.customerName)}
                      </button>
                    ))}
                    {entries.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setSelected(entries[3] ?? null)}
                        className="block w-full rounded-md px-1.5 py-1 text-left text-[10px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        +{entries.length - 3} more
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phones: agenda list for the shown month. */}
        <div className="space-y-3 sm:hidden">
          {cells
            .filter((cell) => cell.inMonth && (byDay.get(cell.key) ?? []).length > 0)
            .map((cell) => (
              <div key={cell.key}>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  {longDateLabel(`${cell.key}T12:00:00Z`, timezone)}
                </p>
                <ul className="space-y-1.5">
                  {(byDay.get(cell.key) ?? []).map((entry) => (
                    <li key={entry.jobId}>
                      <button
                        type="button"
                        onClick={() => setSelected(entry)}
                        className="min-h-14 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold">
                            {customerLabel(entry.customerName)}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${stateClasses(entry.state)}`}
                          >
                            {entry.scheduledAt ? timeLabel(entry.scheduledAt, timezone) : "—"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.serviceName ?? "Service to confirm"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {cells.every((cell) => !cell.inMonth || (byDay.get(cell.key) ?? []).length === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing booked this month.
            </p>
          ) : null}
        </div>
      </section>

      {selected ? (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-foreground/25 sm:items-center sm:justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Booking details"
        >
          <button
            type="button"
            aria-label="Close booking details"
            className="absolute inset-0 -z-10 h-full w-full cursor-default"
            onClick={() => setSelected(null)}
          />
          <div className="max-h-[85dvh] w-full min-w-0 overflow-y-auto rounded-t-2xl border border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-heading text-base font-semibold">
                  {customerLabel(selected.customerName)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {bookingStateText(selected.state)}
                  {selected.scheduledAt
                    ? ` · ${longDateLabel(selected.scheduledAt, timezone)}, ${timeLabel(selected.scheduledAt, timezone)}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-10 shrink-0"
                aria-label="Close booking details"
                onClick={() => setSelected(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Service booked</dt>
                <dd className="font-medium">{selected.serviceName ?? "To be confirmed"}</dd>
              </div>
              {selected.phone ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Mobile</dt>
                  <dd className="flex items-center gap-1.5 font-medium">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <a href={`tel:${selected.phone}`} className="underline-offset-2 hover:underline">
                      {selected.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {selected.address || selected.suburb ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Where</dt>
                  <dd className="flex items-start gap-1.5 font-medium">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">
                      {[selected.address, selected.suburb].filter(Boolean).join(", ")}
                    </span>
                  </dd>
                </div>
              ) : null}
              {selected.state === "completed" ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Recorded amount</dt>
                  <dd className="font-medium">{money(selected.completedValue)}</dd>
                </div>
              ) : null}
              {visibleNotes(selected.notes) ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-line break-words">{visibleNotes(selected.notes)}</dd>
                </div>
              ) : null}
            </dl>
            <Link
              to="/leads/$leadId"
              params={{ leadId: selected.leadId }}
              onClick={() => setSelected(null)}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Open customer record
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
