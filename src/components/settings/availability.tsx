import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveAvailabilitySettings } from "@/lib/app.functions";
import { WEEKDAY_LABELS, type AvailabilityWindow } from "@/lib/availability";

/**
 * Owner-controlled bookable availability. This is the only source the server
 * uses to compute appointment options — free-text opening hours stay purely
 * descriptive, and nothing here sends a message on its own.
 */
export type AvailabilityRow = {
  active: boolean;
  lead_time_minutes: number;
  horizon_days: number;
  offer_ttl_minutes: number;
  weekly_windows: unknown;
};

const EMPTY: AvailabilityRow = {
  active: false,
  lead_time_minutes: 120,
  horizon_days: 7,
  offer_ttl_minutes: 120,
  weekly_windows: [],
};

function toWindows(value: unknown): AvailabilityWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const weekday = Number(row["weekday"]);
    const start = typeof row["start"] === "string" ? row["start"] : "";
    const end = typeof row["end"] === "string" ? row["end"] : "";
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !start || !end) return [];
    return [{ weekday, start, end }];
  });
}

/**
 * Presentation-only helpers. Stored values stay exactly as before:
 * minutes for durations, whole days for the booking window.
 */
type RuleField = "lead_time_minutes" | "horizon_days" | "offer_ttl_minutes";

type Rule = {
  field: RuleField;
  label: string;
  tip: string;
  unit: "minutes" | "days";
  presets: number[];
  format: (value: number) => string;
};

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Not set";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, "");
  return `${text} ${hours === 1 ? "hour" : "hours"}`;
}

const RULES: Rule[] = [
  {
    field: "lead_time_minutes",
    label: "Earliest booking",
    tip: "The soonest an offered appointment can start from now.",
    unit: "minutes",
    presets: [60, 120, 240, 1440],
    format: (value) => (value === 1440 ? "Tomorrow" : `${formatDuration(value)} from now`),
  },
  {
    field: "horizon_days",
    label: "Booking window",
    tip: "How far into the future appointment times can be offered.",
    unit: "days",
    presets: [3, 7, 14, 30],
    format: (value) => `Next ${value} ${value === 1 ? "day" : "days"}`,
  },
  {
    field: "offer_ttl_minutes",
    label: "Customer response time",
    tip: "How long an offered time is held before it expires.",
    unit: "minutes",
    presets: [30, 60, 120, 240],
    format: formatDuration,
  },
];

function RuleCard({
  rule,
  value,
  readOnly,
  onChange,
}: {
  rule: Rule;
  value: number;
  readOnly: boolean;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const isPreset = rule.presets.includes(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCustom(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={readOnly}
          className="rounded-md border border-input bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/50 disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {rule.label}
            <span title={rule.tip} className="inline-flex">
              <Info className="h-3.5 w-3.5 shrink-0" aria-label={rule.tip} />
            </span>
          </span>
          <span className="mt-1 block text-sm font-medium text-foreground">
            {rule.format(value)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="space-y-0.5">
          {rule.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onChange(preset);
                setOpen(false);
              }}
              className={`block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted ${
                value === preset ? "bg-muted font-medium" : ""
              }`}
            >
              {rule.format(preset)}
            </button>
          ))}
          {custom || !isPreset ? (
            <label className="block px-2.5 pb-1 pt-2 text-xs text-muted-foreground">
              Custom ({rule.unit})
              <input
                type="number"
                min={0}
                autoFocus={custom}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              Custom…
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AvailabilityEditor({
  availability,
  timezone,
  readOnly,
}: {
  availability: AvailabilityRow | null;
  timezone: string;
  readOnly: boolean;
}) {
  const initial = availability ?? EMPTY;
  const save = useServerFn(saveAvailabilitySettings);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    active: Boolean(initial.active),
    lead_time_minutes: Number(initial.lead_time_minutes ?? 120),
    horizon_days: Number(initial.horizon_days ?? 7),
    offer_ttl_minutes: Number(initial.offer_ttl_minutes ?? 120),
  });
  const [windows, setWindows] = useState<AvailabilityWindow[]>(toWindows(initial.weekly_windows));

  const mutation = useMutation({
    mutationFn: () => save({ data: { ...form, weekly_windows: windows } }),
    onSuccess: () => {
      toast.success("Availability saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const update = (index: number, patch: Partial<AvailabilityWindow>) =>
    setWindows(windows.map((window, i) => (i === index ? { ...window, ...patch } : window)));

  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">Bookable availability</div>
      <div className="p-4">
        <p className="text-xs text-muted-foreground">
          Appointment times are worked out by the system from these windows in {timezone}, using
          each approved service's own appointment duration. Quiet hours, already-booked jobs and
          times too soon from now are always excluded. Times are only ever sent to a customer when
          you choose to offer them.
        </p>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          <span>Offer appointment times to customers</span>
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {RULES.map((rule) => (
            <RuleCard
              key={rule.field}
              rule={rule}
              value={form[rule.field]}
              readOnly={readOnly}
              onChange={(value) => setForm({ ...form, [rule.field]: value })}
            />
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium">Weekly working windows</p>
          {windows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No windows set, so no appointment times can be offered.
            </p>
          )}
          {windows.map((window, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                disabled={readOnly}
                value={window.weekday}
                onChange={(event) => update(index, { weekday: Number(event.target.value) })}
                className="form-control w-auto disabled:opacity-60"
              >
                {WEEKDAY_LABELS.map((label, day) => (
                  <option key={label} value={day}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                disabled={readOnly}
                value={window.start}
                onChange={(event) => update(index, { start: event.target.value })}
                className="form-control w-auto disabled:opacity-60"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                disabled={readOnly}
                value={window.end}
                onChange={(event) => update(index, { end: event.target.value })}
                className="form-control w-auto disabled:opacity-60"
              />
              {!readOnly && (
                <button
                  onClick={() => setWindows(windows.filter((_, i) => i !== index))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              onClick={() => setWindows([...windows, { weekday: 1, start: "09:00", end: "16:00" }])}
              className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Add window
            </button>
          )}
        </div>

        {!readOnly && (
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save availability"}
          </button>
        )}
      </div>
    </section>
  );
}
