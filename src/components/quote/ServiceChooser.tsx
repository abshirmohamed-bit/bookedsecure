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
import { ChevronLeft, ChevronRight, Check, Minus, Plus, X } from "lucide-react";
import { groupItems, hasMeaningfulGroups } from "@/lib/service-groups";
import type { QuoteServiceLayout } from "@/lib/quote-service-layout";
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
  image?: string | null;
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
  quantityLabel = "Vehicle",
  layout = "focused_list",
  onSubmit,
}: {
  options: ServiceOption[];
  busy: boolean;
  flexibleValue: string;
  quantityLabel?: string;
  layout?: QuoteServiceLayout;
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
  // When any card in the visible group carries a picture, every card in that
  // group uses the taller size so rows stay aligned.
  const tallCards = items.some((option) => Boolean(option.card?.image));

  /** Chosen services, in the order the customer picked them. */
  const [chosen, setChosen] = useState<string[]>([]);
  /** Chosen extras, by add-on id. */
  const [extras, setExtras] = useState<string[]>([]);
  /** Number of vehicles per chosen service; a missing entry means one. */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  /** Which selected services currently show their extras inside the selection list. */
  const [extrasOpen, setExtrasOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<ServiceOption | null>(null);
  const [guidedIndex, setGuidedIndex] = useState(0);

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

        {card?.image && (
          <img
            src={card.image}
            alt={detail.label}
            loading="lazy"
            decoding="async"
            className="mb-3 max-h-48 w-full rounded-xl object-cover"
          />
        )}
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

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-0.5">
        <h3 className="min-w-0 truncate text-xs font-semibold text-foreground">
          {activeGroup?.label}
          <span className="ml-2 font-normal text-muted-foreground">{items.length} services</span>
        </h3>
        {layout === "guided_conversation" && items.length > 1 && (
          <span className="text-xs tabular text-muted-foreground">
            {Math.min(guidedIndex + 1, items.length)} of {items.length}
          </span>
        )}
      </div>

      <div
        className={
          layout === "guided_conversation"
            ? "overflow-hidden"
            : "no-scrollbar max-h-[21rem] overflow-y-auto overscroll-y-contain pr-0.5 sm:max-h-[26rem]"
        }
      >
        <div
          className={
            layout === "focused_list"
              ? "grid grid-cols-1 gap-2"
              : layout === "compact_grid"
                ? "grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3"
                : "grid grid-cols-1"
          }
        >
          {(layout === "guided_conversation" ? items.slice(guidedIndex, guidedIndex + 1) : items).map((option) => {
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
                  className={`relative w-full cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    layout === "focused_list"
                      ? "grid min-h-[5.75rem] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] gap-x-3 px-3 py-2.5"
                      : layout === "guided_conversation"
                        ? "grid min-h-[12rem] grid-rows-[auto_minmax(0,1fr)_auto_auto] p-4"
                        : `${tallCards ? "h-[11rem] grid grid-rows-[auto_minmax(0,1fr)_auto_auto]" : "h-[9.5rem] grid grid-rows-[minmax(0,1fr)_auto_auto]"} p-2.5`
                  } ${
                    busy ? "opacity-50" : ""
                  } ${
                    picked
                      ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-border hover:border-primary/60"
                  }`}
                >
                  {layout !== "focused_list" && tallCards &&
                    (card?.image ? (
                      <img
                        src={card.image}
                        alt={option.label}
                        loading="lazy"
                        decoding="async"
                        className={`mb-2 w-full shrink-0 rounded-md object-cover ${layout === "guided_conversation" ? "h-20" : "h-12"}`}
                      />
                    ) : (
                      <span aria-hidden="true" className={`mb-2 w-full shrink-0 rounded-md bg-secondary ${layout === "guided_conversation" ? "h-20" : "h-12"}`} />
                    ))}
                  <span
                    aria-hidden="true"
                    className={`absolute right-2 top-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      picked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-transparent"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>

                  <p
                    title={option.label}
                    className={`min-h-0 min-w-0 overflow-hidden break-words pr-6 font-semibold leading-snug ${
                      layout === "focused_list"
                        ? "col-start-1 row-start-1 text-sm"
                        : layout === "guided_conversation"
                          ? "line-clamp-3 text-base"
                          : "line-clamp-3 text-xs"
                    }`}
                  >
                    {option.label}
                  </p>
                  <div className={`min-w-0 shrink-0 ${layout === "focused_list" ? "col-start-1 row-start-2 self-end" : ""}`}>
                    <p className={`${layout === "focused_list" ? "text-sm" : "text-xs"} break-words font-bold leading-tight text-primary`}>
                      {card?.price ?? "On enquiry"}
                    </p>
                    {card?.duration && (
                      <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
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
                    className={`flex shrink-0 items-center justify-center rounded-md border border-border bg-secondary px-3 text-center text-xs font-semibold text-foreground hover:bg-secondary/70 ${
                      layout === "focused_list"
                        ? "col-start-2 row-span-3 row-start-1 min-h-11 self-center"
                        : "mt-2 min-h-10 w-full"
                    }`}
                  >
                    Details
                  </button>


                </div>
              </div>
            );
          })}
        </div>
      </div>

      {layout === "guided_conversation" && items.length > 1 && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <button
            type="button"
            disabled={guidedIndex === 0}
            onClick={() => setGuidedIndex((current) => Math.max(0, current - 1))}
            className="grid h-11 w-11 place-items-center rounded-md border border-border bg-card text-foreground disabled:opacity-35"
            aria-label="Previous service"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${((guidedIndex + 1) / items.length) * 100}%` }}
            />
          </div>
          <button
            type="button"
            disabled={guidedIndex >= items.length - 1}
            onClick={() => setGuidedIndex((current) => Math.min(items.length - 1, current + 1))}
            className="grid h-11 w-11 place-items-center rounded-md border border-border bg-card text-foreground disabled:opacity-35"
            aria-label="Next service"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-card p-2.5">
          <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
            Your selection
          </p>
          <ul className="mt-1.5 space-y-1">
            {chosenOptions.map((option) => {
              const count = quantities[option.value] ?? 1;
              const cardExtras = option.card?.extras ?? [];
              const hasExtras = cardExtras.length > 0;
              const open = extrasOpen[option.value] ?? false;
              const chosenCount = cardExtras.filter((extra) => extras.includes(extra.id)).length;
              return (
                <li
                  key={option.value}
                  className="rounded-lg border border-primary/40 bg-primary/10"
                >
                   <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2">
                     <span className="min-w-0 break-words text-xs font-semibold text-foreground">
                      {option.label}
                    </span>
                     <button
                       type="button"
                       onClick={() => toggleService(option)}
                       className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                       aria-label={`Remove ${option.label}`}
                     >
                       <X className="h-3.5 w-3.5" aria-hidden="true" />
                     </button>
                     <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2">
                      {hasExtras && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-expanded={open}
                        aria-label={`Add-ons for ${option.label}`}
                        onClick={() =>
                          setExtrasOpen((current) => ({
                            ...current,
                            [option.value]: !open,
                          }))
                        }
                        className={`inline-flex h-7 items-center gap-0.5 rounded-md border px-1.5 text-[0.62rem] font-semibold ${
                          chosenCount > 0
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-secondary"
                        }`}
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        <span>Add-ons{chosenCount > 0 ? ` ${chosenCount}` : ""}</span>
                      </button>
                      )}
                    <span
                      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card"
                      role="group"
                      aria-label={`${quantityLabel}s for ${option.label}`}
                    >
                      <button
                        type="button"
                        disabled={busy || count <= 1}
                        onClick={() => adjustQuantity(option.value, -1)}
                        aria-label={`Fewer ${quantityLabel.toLowerCase()}s for ${option.label}`}
                        className="grid h-7 w-7 place-items-center text-foreground disabled:opacity-40"
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="min-w-[3.4rem] text-center text-[0.65rem] font-semibold text-foreground">
                        {count} {count === 1 ? quantityLabel.toLowerCase() : `${quantityLabel.toLowerCase()}s`}
                      </span>
                      <button
                        type="button"
                        disabled={busy || count >= MAX_SERVICE_QUANTITY}
                        onClick={() => adjustQuantity(option.value, 1)}
                        aria-label={`More ${quantityLabel.toLowerCase()}s for ${option.label}`}
                        className="grid h-7 w-7 place-items-center text-foreground disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                     </div>
                  </div>
                  {hasExtras && open && (
                    <div className="grid gap-1 border-t border-primary/20 p-1.5 sm:grid-cols-2">
                      {cardExtras.map((extra) => {
                        const on = extras.includes(extra.id);
                        return (
                          <button
                            key={extra.id}
                            type="button"
                            disabled={busy}
                            aria-pressed={on}
                            onClick={() => toggleExtra(extra.id)}
                            className={`grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[0.65rem] ${
                              on
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-card text-muted-foreground"
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
                  )}
                </li>
              );
            })}
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

    </div>
  );
}
