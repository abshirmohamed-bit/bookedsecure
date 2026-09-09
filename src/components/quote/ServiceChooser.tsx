/**
 * Customer-facing service chooser for the AI quote conversation.
 *
 * Display only. Every service, group heading, price, length and extra shown
 * here is the tenant's own approved wording, passed straight through from the
 * server. Nothing is computed, ranked or invented here.
 *
 * The customer can tick more than one service, and each ticked card reveals
 * that service's own optional extras underneath it. The whole selection is sent
 * as one encoded answer, so the server state machine keeps a single answer per
 * step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check, Plus, X } from "lucide-react";
import { groupItems, hasMeaningfulGroups } from "@/lib/service-groups";
import { encodeServiceSelection, type WebChatCardExtra } from "@/lib/web-chat";

export type ServiceCard = {
  group: string | null;
  price: string | null;
  duration: string | null;
  description: string | null;
  includes: string | null;
  excludes: string | null;
  note: string | null;
  extras: WebChatCardExtra[];
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
  onSubmit,
  onFlexible,
}: {
  options: ServiceOption[];
  busy: boolean;
  flexibleValue: string;
  onSubmit: (value: string, label: string) => void;
  onFlexible: () => void;
}) {
  const services = options.filter((option) => option.value !== flexibleValue);
  const flexible = options.find((option) => option.value === flexibleValue) ?? null;
  const groups = useMemo(
    () => groupItems(services, (option) => option.card?.group ?? null),
    [services],
  );
  const showGroupPicker = hasMeaningfulGroups(groups);

  const [groupLabel, setGroupLabel] = useState<string>(() => groups[0]?.label ?? "");
  const activeGroup =
    groups.find((group) => group.label.toLowerCase() === groupLabel.toLowerCase()) ?? groups[0];
  const items = activeGroup?.items ?? [];

  /** Chosen services, in the order the customer picked them. */
  const [chosen, setChosen] = useState<string[]>([]);
  /** Chosen extras, by add-on id. */
  const [extras, setExtras] = useState<string[]>([]);
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

  const chosenOptions = chosen
    .map((value) => services.find((option) => option.value === value))
    .filter((option): option is ServiceOption => Boolean(option));

  function toggleService(option: ServiceOption) {
    setChosen((current) =>
      current.includes(option.value)
        ? current.filter((value) => value !== option.value)
        : [...current, option.value],
    );
    // Extras belong to a service: dropping the service drops its extras.
    const ids = (option.card?.extras ?? []).map((extra) => extra.id);
    if (chosen.includes(option.value) && ids.length > 0) {
      setExtras((current) => current.filter((id) => !ids.includes(id)));
    }
  }

  function toggleExtra(id: string) {
    setExtras((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function submit() {
    if (chosen.length === 0 || busy) return;
    const extraNames = chosenOptions
      .flatMap((option) => option.card?.extras ?? [])
      .filter((extra) => extras.includes(extra.id))
      .map((extra) => extra.name);
    const label = [
      chosenOptions.map((option) => option.label).join(" + "),
      extraNames.length > 0 ? `with ${extraNames.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    onSubmit(encodeServiceSelection(chosen, extras), label);
  }

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
            {card?.price && <span className="text-base font-bold text-primary">{card.price}</span>}
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
            <ul className="mt-1.5 space-y-1.5">
              {card.extras.map((extra) => (
                <li
                  key={extra.id}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="min-w-0">{extra.name}</span>
                  {extra.price && (
                    <span className="shrink-0 font-semibold text-primary">{extra.price}</span>
                  )}
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
            onClick={() => {
              if (!chosen.includes(detail.value)) setChosen((current) => [...current, detail.value]);
              setDetail(null);
            }}
            className="flex-[1.5] rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 active:scale-95 disabled:opacity-50"
          >
            {chosen.includes(detail.value) ? "Keep this service" : "Add this service"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showGroupPicker && (
        <label className="block">
          <span className="mb-1 block text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
            Service group
          </span>
          <select
            value={activeGroup?.label ?? ""}
            onChange={(event) => setGroupLabel(event.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {groups.map((group) => (
              <option key={group.label} value={group.label}>
                {group.label} ({group.items.length})
              </option>
            ))}
          </select>
        </label>
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
          className="no-scrollbar flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain pb-1"
        >
          {items.map((option) => {
            const card = option.card ?? null;
            const picked = chosen.includes(option.value);
            const cardExtras = card?.extras ?? [];
            return (
              <div
                key={option.value}
                className="w-[10.5rem] shrink-0 snap-start sm:w-[15rem]"
              >
                <div
                  role="button"
                  tabIndex={busy ? -1 : 0}
                  aria-pressed={picked}
                  aria-label={`Choose ${option.label}`}
                  onClick={() => !busy && toggleService(option)}
                  onKeyDown={(event) => {
                    if (busy) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleService(option);
                    }
                  }}
                  className={`flex h-full w-full cursor-pointer flex-col rounded-xl border bg-card p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-3 ${
                    busy ? "opacity-50" : ""
                  } ${
                    picked
                      ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-border hover:border-primary/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    {card?.group ? (
                      <span className="truncate rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-tight text-muted-foreground">
                        {card.group}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-transparent"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>

                  <p className="mt-1.5 text-[0.8rem] font-semibold leading-tight">{option.label}</p>
                  {card?.description && (
                    <p className="mt-1 hidden line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground sm:block">
                      {card.description}
                    </p>
                  )}

                  <div className="mt-auto flex items-baseline justify-between gap-1.5 pt-2">
                    <p className="truncate text-[0.8rem] font-bold text-primary">
                      {card?.price ?? "On enquiry"}
                    </p>
                    {card?.duration && (
                      <p className="shrink-0 text-[0.65rem] text-muted-foreground">{card.duration}</p>
                    )}
                  </div>

                  {/* The service's own extras, only once it is chosen. */}
                  {picked && cardExtras.length > 0 && (
                    <div className="mt-2 rounded-lg bg-secondary/60 p-1.5">
                      <p className="text-[0.6rem] font-bold uppercase tracking-widest text-muted-foreground">
                        Add extras
                      </p>
                      <ul className="mt-1 space-y-1">
                        {cardExtras.map((extra) => {
                          const on = extras.includes(extra.id);
                          return (
                            <li key={extra.id}>
                              <button
                                type="button"
                                aria-pressed={on}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExtra(extra.id);
                                }}
                                className={`flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[0.65rem] transition-colors ${
                                  on
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                    on
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border"
                                  }`}
                                >
                                  {on ? (
                                    <Check className="h-2.5 w-2.5" />
                                  ) : (
                                    <Plus className="h-2.5 w-2.5 opacity-60" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{extra.name}</span>
                                {extra.price && (
                                  <span className="shrink-0 font-semibold text-primary">
                                    {extra.price}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetail(option);
                      }}
                      className="w-full rounded-lg border border-border bg-secondary px-1.5 py-1.5 text-center text-[0.65rem] font-semibold text-foreground hover:bg-secondary/70"
                    >
                      Details
                    </button>
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

      {chosen.length > 0 && (
        <div className="rounded-2xl border border-primary/40 bg-card p-3">
          <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
            Your selection
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {chosenOptions.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => toggleService(option)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-semibold text-foreground"
                  aria-label={`Remove ${option.label}`}
                >
                  {option.label}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="mt-3 w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-50"
          >
            {chosen.length > 1 ? `Continue with ${chosen.length} services` : "Continue"}
          </button>
        </div>
      )}

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
