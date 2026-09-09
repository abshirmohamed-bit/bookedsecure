/**
 * Customer-facing service chooser for the AI quote conversation.
 *
 * Display only. Every service, group heading, price, length and extra shown
 * here is the tenant's own approved wording, passed straight through from the
 * server. Nothing is computed, ranked or invented here, and choosing a card
 * sends exactly the same option value the flat list used to send, so the
 * server state machine is untouched.
 *
 * Layout: a horizontal snap carousel — one card per view on a phone, two and a
 * bit on wider screens — so the panel never grows tall and the page itself
 * never scrolls sideways.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { groupItems, hasMeaningfulGroups } from "@/lib/service-groups";

export type ServiceCard = {
  group: string | null;
  price: string | null;
  duration: string | null;
  description: string | null;
  includes: string | null;
  excludes: string | null;
  note: string | null;
  extras: string[];
};

export type ServiceOption = {
  value: string;
  label: string;
  detail: string | null;
  card?: ServiceCard | null;
};

export function ServiceChooser({
  options,
  busy,
  flexibleValue,
  onChoose,
  onFlexible,
}: {
  options: ServiceOption[];
  busy: boolean;
  flexibleValue: string;
  onChoose: (option: ServiceOption) => void;
  onFlexible: () => void;
}) {
  const services = options.filter((option) => option.value !== flexibleValue);
  const flexible = options.find((option) => option.value === flexibleValue) ?? null;
  const groups = useMemo(
    () => groupItems(services, (option) => option.card?.group ?? null),
    [services],
  );
  const showChips = hasMeaningfulGroups(groups);

  const [groupLabel, setGroupLabel] = useState<string>(() => groups[0]?.label ?? "");
  const activeGroup =
    groups.find((group) => group.label.toLowerCase() === groupLabel.toLowerCase()) ?? groups[0];
  const items = activeGroup?.items ?? [];

  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceOption | null>(null);

  const track = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  const measure = useCallback(() => {
    const node = track.current;
    if (!node) return;
    const span = node.scrollWidth - node.clientWidth;
    setProgress(span > 0 ? node.scrollLeft / span : 0);
  }, []);

  useEffect(() => {
    // New group means a fresh row: back to the start.
    track.current?.scrollTo({ left: 0 });
    setProgress(0);
  }, [activeGroup?.label]);

  const nudge = (direction: 1 | -1) => {
    const node = track.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(240, node.clientWidth * 0.8), behavior: "smooth" });
  };

  if (detail) {
    const card = detail.card ?? null;
    return (
      <div className="rounded-2xl border border-primary/50 bg-card p-4 shadow-lg">
        <button
          type="button"
          onClick={() => setDetail(null)}
          className="mb-3 inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back to options
        </button>

        <p className="text-lg font-semibold leading-tight">{detail.label}</p>
        {(card?.price || card?.duration) && (
          <div className="mt-2 flex flex-wrap items-baseline gap-4">
            {card?.price && (
              <span className="text-base font-bold text-primary">{card.price}</span>
            )}
            {card?.duration && (
              <span className="text-xs text-muted-foreground">{card.duration}</span>
            )}
          </div>
        )}
        {card?.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
        )}
        {card?.includes && (
          <div className="mt-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-widest text-primary">
              What's included
            </p>
            <p className="mt-1.5 flex gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{card.includes}</span>
            </p>
          </div>
        )}
        {card?.excludes && (
          <div className="mt-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
              Not included
            </p>
            <p className="mt-1.5 flex gap-2 text-sm text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{card.excludes}</span>
            </p>
          </div>
        )}
        {card?.extras && card.extras.length > 0 && (
          <div className="mt-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
              Optional extras
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {card.extras.map((extra) => (
                <li
                  key={extra}
                  className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {extra}
                </li>
              ))}
            </ul>
          </div>
        )}
        {card?.note && <p className="mt-3 text-xs text-muted-foreground">{card.note}</p>}
        {!card && detail.detail && (
          <p className="mt-3 text-sm text-muted-foreground">{detail.detail}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="flex-1 rounded-xl border border-border bg-secondary px-3 py-2.5 text-xs font-semibold text-foreground hover:bg-secondary/70"
          >
            Go back
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(detail)}
            className="flex-[1.5] rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 active:scale-95 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showChips && (
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-0.5">
          {groups.map((group) => {
            const active = group.label.toLowerCase() === (activeGroup?.label ?? "").toLowerCase();
            return (
              <button
                key={group.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setGroupLabel(group.label);
                  setActiveValue(null);
                }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {group.label}
                <span className="ml-1.5 opacity-60">{group.items.length}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="min-w-0 truncate text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
          {activeGroup?.label}
          <span className="ml-2 font-medium opacity-70">{items.length}</span>
        </h3>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          <button
            type="button"
            aria-label="Previous services"
            onClick={() => nudge(-1)}
            className="rounded-full border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="More services"
            onClick={() => nudge(1)}
            className="rounded-full border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={track}
          onScroll={measure}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1"
        >
          {items.map((option) => {
            const card = option.card ?? null;
            const active = activeValue === option.value;
            return (
              <div
                key={option.value}
                className="min-w-[85%] shrink-0 snap-center sm:min-w-[15rem] sm:max-w-[16rem]"
              >
                <div
                  role="button"
                  tabIndex={busy ? -1 : 0}
                  aria-pressed={active}
                  aria-label={`Select ${option.label}`}
                  onClick={() => !busy && setActiveValue(active ? null : option.value)}
                  onKeyDown={(event) => {
                    if (busy) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveValue(active ? null : option.value);
                    }
                  }}
                  className={`flex h-full w-full cursor-pointer flex-col rounded-2xl border bg-card p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    busy ? "opacity-50" : ""
                  } ${
                    active
                      ? "-translate-y-0.5 border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-border hover:border-primary/60"
                  }`}
                >

                  {card?.group && (
                    <span className="w-fit rounded bg-secondary px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-tight text-muted-foreground">
                      {card.group}
                    </span>
                  )}
                  <p className="mt-3 text-sm font-semibold leading-tight">{option.label}</p>
                  {card?.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                      {card.description}
                    </p>
                  )}

                  <div className="mt-auto pt-3">
                    <div className="flex items-end justify-between border-t border-border pt-3">
                      <div className="min-w-0">
                        <p className="text-[0.65rem] font-medium uppercase text-muted-foreground">
                          Price
                        </p>
                        <p className="truncate text-sm font-bold text-primary">
                          {card?.price ?? "On enquiry"}
                        </p>
                      </div>
                      {card?.duration && (
                        <div className="ml-2 shrink-0 text-right">
                          <p className="text-[0.65rem] font-medium uppercase text-muted-foreground">
                            Time
                          </p>
                          <p className="text-xs text-muted-foreground">{card.duration}</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-3">
                      {active ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveValue(null);
                            }}
                            className="flex-1 rounded-xl border border-border bg-secondary px-2 py-2 text-center text-[0.7rem] font-semibold text-foreground hover:bg-secondary/70"
                          >
                            Unselect
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetail(option);
                            }}
                            className="flex-[1.5] rounded-xl bg-primary px-2 py-2 text-center text-[0.7rem] font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95"
                          >
                            View details
                          </button>
                        </div>
                      ) : (
                        <span className="block rounded-xl border border-primary/30 bg-primary/10 px-2 py-2 text-center text-[0.7rem] font-semibold text-primary">
                          Select service
                        </span>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>

        {items.length > 1 && (
          <div className="mx-auto mt-2 h-1 w-24 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(20 + progress * 80)}%` }}
            />
          </div>
        )}
      </div>

      {flexible && (
        <button
          type="button"
          disabled={busy}
          aria-label="Something else or not sure, type your own request"
          onClick={onFlexible}
          className="w-full rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          Something else or not sure? Tell us what you need.
        </button>
      )}
    </div>
  );
}
