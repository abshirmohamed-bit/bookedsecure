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

import { useMemo, useState } from "react";
import { ChevronLeft, Check, Minus, Plus, X } from "lucide-react";
import { groupItems, hasMeaningfulGroups } from "@/lib/service-groups";
import {
  encodeServiceSelection,
  MAX_SERVICE_QUANTITY,
  type WebChatCardExtra,
} from "@/lib/web-chat";

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
}: {
  options: ServiceOption[];
  busy: boolean;
  flexibleValue: string;
  onSubmit: (value: string, label: string) => void;
}) {
  const services = options.filter((option) => option.value !== flexibleValue);
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
  /** Number of vehicles per chosen service; a missing entry means one. */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<ServiceOption | null>(null);

  const chosenOptions = chosen
    .map((value) => services.find((option) => option.value === value))
    .filter((option): option is ServiceOption => Boolean(option));

  function toggleService(option: ServiceOption) {
    setChosen((current) =>
      current.includes(option.value)
        ? current.filter((value) => value !== option.value)
        : [...current, option.value],
    );
    // Extras and vehicle counts belong to a service: dropping it drops them.
    const ids = (option.card?.extras ?? []).map((extra) => extra.id);
    if (chosen.includes(option.value)) {
      if (ids.length > 0) setExtras((current) => current.filter((id) => !ids.includes(id)));
      setQuantities((current) => {
        const { [option.value]: _dropped, ...rest } = current;
        return rest;
      });
    }
  }

  function toggleExtra(id: string) {
    setExtras((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function adjustQuantity(value: string, delta: number) {
    setQuantities((current) => {
      const next = Math.min(MAX_SERVICE_QUANTITY, Math.max(1, (current[value] ?? 1) + delta));
      const { [value]: _old, ...rest } = current;
      return next > 1 ? { ...rest, [value]: next } : rest;
    });
  }

  function submit() {
    if (chosen.length === 0 || busy) return;
    const extraNames = chosenOptions
      .flatMap((option) => option.card?.extras ?? [])
      .filter((extra) => extras.includes(extra.id))
      .map((extra) => extra.name);
    const label = [
      chosenOptions
        .map((option) => {
          const count = quantities[option.value] ?? 1;
          return count > 1 ? `${option.label} ×${count}` : option.label;
        })
        .join(" + "),
      extraNames.length > 0 ? `with ${extraNames.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    onSubmit(encodeServiceSelection(chosen, extras, quantities), label);
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

      <div className="px-1">
        <h3 className="min-w-0 truncate text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
          {activeGroup?.label}
          <span className="ml-2 font-medium opacity-70">{items.length}</span>
        </h3>
      </div>

      <div className="no-scrollbar max-h-[19.75rem] snap-y snap-proximity scroll-py-1 overflow-y-auto overscroll-y-contain pr-0.5 sm:max-h-[23.5rem]">
        <div className="grid grid-cols-3 items-stretch gap-1.5 sm:gap-2">
          {items.map((option) => {
            const card = option.card ?? null;
            const picked = chosen.includes(option.value);
            return (
              <div key={option.value} className="h-full min-w-0">
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
                  className={`relative flex h-[7.6rem] w-full snap-start cursor-pointer flex-col overflow-hidden rounded-lg border bg-card p-1.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-[9rem] sm:p-2 ${
                    busy ? "opacity-50" : ""
                  } ${
                    picked
                      ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-border hover:border-primary/60"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute right-1.5 top-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      picked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-transparent"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>

                  <p
                    title={option.label}
                    className={`min-w-0 flex-1 break-words pr-4 font-semibold leading-[1.15] ${
                      option.label.length > 24
                        ? "line-clamp-3 text-[0.6rem] sm:text-[0.7rem]"
                        : "line-clamp-2 text-[0.66rem] sm:text-[0.78rem]"
                    }`}
                  >
                    {option.label}
                  </p>
                  <div className="min-w-0 shrink-0">
                    <p className="truncate text-[0.62rem] font-bold leading-tight text-primary sm:text-[0.72rem]">
                      {card?.price ?? "On enquiry"}
                    </p>
                    {card?.duration && (
                      <p className="truncate text-[0.56rem] leading-tight text-muted-foreground sm:text-[0.64rem]">
                        {card.duration}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetail(option);
                    }}
                    className="mt-1 flex h-7 w-full shrink-0 items-center justify-center rounded-md border border-border bg-secondary px-1 text-center text-[0.62rem] font-semibold text-foreground hover:bg-secondary/70 sm:h-8 sm:text-[0.68rem]"
                  >
                    Details
                  </button>


                </div>
              </div>
            );
          })}
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-card p-2.5">
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
          {chosenOptions.some((option) => (option.card?.extras.length ?? 0) > 0) && (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              {chosenOptions.map((option) => {
                const cardExtras = option.card?.extras ?? [];
                if (cardExtras.length === 0) return null;
                return (
                  <div key={option.value}>
                    <p className="truncate text-[0.65rem] font-semibold text-muted-foreground">
                      Extras for {option.label}
                    </p>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {cardExtras.map((extra) => {
                        const on = extras.includes(extra.id);
                        return (
                          <button
                            key={extra.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleExtra(extra.id)}
                            className={`grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[0.65rem] ${
                              on
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-secondary text-muted-foreground"
                            }`}
                          >
                            <span className={`grid h-4 w-4 place-items-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                              {on ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                            </span>
                            <span className="min-w-0 truncate">{extra.name}</span>
                            {extra.price && <span className="shrink-0 font-semibold text-primary">{extra.price}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

    </div>
  );
}
