/**
 * Customer-facing service chooser for the AI quote conversation.
 *
 * Display only. Every service, group heading, price, length and extra shown
 * here is the tenant's own approved wording, passed straight through from the
 * server. Nothing is computed, ranked or invented here, and choosing a card
 * sends exactly the same option value the flat list used to send, so the
 * server state machine is untouched.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, Clock, Check, X } from "lucide-react";
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
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<ServiceOption | null>(null);

  if (open) {
    const card = open.card ?? null;
    return (
      <div className="rounded-xl border border-primary/40 bg-card p-4 shadow-sm">
        <p className="text-base font-semibold">{open.label}</p>
        {(card?.price || card?.duration) && (
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            {card?.price && <span className="font-semibold text-primary">{card.price}</span>}
            {card?.duration && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {card.duration}
              </span>
            )}
          </div>
        )}
        {card?.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
        )}
        {card?.includes && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What's included
            </p>
            <p className="mt-1 flex gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{card.includes}</span>
            </p>
          </div>
        )}
        {card?.excludes && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Not included
            </p>
            <p className="mt-1 flex gap-2 text-sm text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{card.excludes}</span>
            </p>
          </div>
        )}
        {card?.extras && card.extras.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Optional extras
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
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
        {!card && open.detail && (
          <p className="mt-3 text-sm text-muted-foreground">{open.detail}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Go back
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(open)}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  const isOpen = (label: string) => activeGroup?.toLowerCase() === label.toLowerCase();

  const renderCards = (items: ServiceOption[]) => (
    <div className="grid gap-1.5">
      {items.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={busy}
          aria-label={`View ${option.label}`}
          onClick={() => setOpen(option)}
          className="rounded-xl border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <p className="text-sm font-semibold leading-tight">{option.label}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
            {option.card?.price && (
              <span className="font-semibold text-primary">{option.card.price}</span>
            )}
            {option.card?.duration && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {option.card.duration}
              </span>
            )}
          </div>
          {option.card?.description && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {option.card.description}
            </p>
          )}
          <span className="mt-1.5 inline-block text-[11px] font-medium text-primary">
            View details
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      {showChips
        ? groups.map((group) => {
            const expanded = isOpen(group.label);
            return (
              <div
                key={group.label}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setActiveGroup(expanded ? null : group.label)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 truncate text-sm font-semibold">{group.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {group.items.length}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-border p-2">{renderCards(group.items)}</div>
                )}
              </div>
            );
          })
        : groups.map((group) => <div key={group.label}>{renderCards(group.items)}</div>)}


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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
