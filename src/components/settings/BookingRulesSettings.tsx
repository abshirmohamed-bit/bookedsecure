import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarOff, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addBookingBlock,
  getBookingSettings,
  removeBookingBlock,
  saveBookingRules,
} from "@/lib/booking-settings.functions";

/**
 * Extra booking rules shown under Bookable availability: travel time between
 * jobs, start-time spacing, the customer reminder and blocked time. They apply
 * to every online booking (quote page and website booking API).
 */
const QUERY_KEY = ["booking-settings"];
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

const BUFFERS = [0, 15, 30, 45, 60, 90, 120];
const STEPS = [15, 30, 60];
const REMINDERS: Array<number | null> = [null, 2, 12, 24, 48];

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function when(value: string) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    .format(new Date(value))
    .replace(/ /g, " ");
}

export function BookingRulesSettings() {
  const load = useServerFn(getBookingSettings);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => load() });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.isError || !query.data) return <p className="text-sm text-destructive">Could not load website booking settings.</p>;
  const data = query.data;
  const readOnly = data.role !== "owner";

  if (!data.ready) {
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-4 text-sm">
        <p className="font-medium">Almost ready</p>
        <p className="mt-1 text-muted-foreground">
          Travel time, reminders and blocked time need a one-time database update before they can be set here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RulesCard rules={data.rules} readOnly={readOnly} />
      <BlocksCard blocks={data.blocks} readOnly={readOnly} />
    </div>
  );
}

function RulesCard({
  rules,
  readOnly,
}: {
  rules: { travel_buffer_minutes: number; slot_step_minutes: number; customer_reminder_hours: number | null };
  readOnly: boolean;
}) {
  const save = useServerFn(saveBookingRules);
  const qc = useQueryClient();
  const [buffer, setBuffer] = useState(rules.travel_buffer_minutes);
  const [step, setStep] = useState(rules.slot_step_minutes);
  const [reminder, setReminder] = useState<number | null>(rules.customer_reminder_hours);
  const mutation = useMutation({
    mutationFn: () => save({ data: { travel_buffer_minutes: buffer, slot_step_minutes: step, customer_reminder_hours: reminder } }),
    onSuccess: async () => {
      toast.success("Booking rules saved");
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(errorText(e, "Could not save.")),
  });
  const options = (values: number[]) => (values.includes(buffer) ? values : [...values, buffer].sort((a, b) => a - b));

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Timer className="h-4 w-4 text-primary" /> Booking rules</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Travel time between jobs</span>
          <select className={selectClass} value={buffer} disabled={readOnly} onChange={(e) => setBuffer(Number(e.target.value))}>
            {options(BUFFERS).map((value) => <option key={value} value={value}>{value === 0 ? "None" : `${value} minutes`}</option>)}
          </select>
          <span className="block text-xs text-muted-foreground">Kept free before and after every booking.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Start times every</span>
          <select className={selectClass} value={step} disabled={readOnly} onChange={(e) => setStep(Number(e.target.value))}>
            {(STEPS.includes(step) ? STEPS : [...STEPS, step].sort((a, b) => a - b)).map((value) => <option key={value} value={value}>{value} minutes</option>)}
          </select>
          <span className="block text-xs text-muted-foreground">How often website start times are offered.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Reminder text</span>
          <select className={selectClass} value={reminder ?? ""} disabled={readOnly} onChange={(e) => setReminder(e.target.value ? Number(e.target.value) : null)}>
            {(REMINDERS.includes(reminder) ? REMINDERS : [...REMINDERS, reminder]).map((value) => (
              <option key={String(value)} value={value ?? ""}>{value === null ? "Off" : `${value} hours before`}</option>
            ))}
          </select>
          <span className="block text-xs text-muted-foreground">One text per booking, to customers who agreed to texts.</span>
        </label>
      </div>
      {!readOnly && <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save rules"}</Button>}
    </section>
  );
}

function BlocksCard({ blocks, readOnly }: { blocks: Array<{ id: string; starts_at: string; ends_at: string; reason: string | null }>; readOnly: boolean }) {
  const add = useServerFn(addBookingBlock);
  const remove = useServerFn(removeBookingBlock);
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const addM = useMutation({
    mutationFn: () => add({ data: { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), reason: reason.trim() || null } }),
    onSuccess: async () => {
      setStart(""); setEnd(""); setReason("");
      toast.success("Time blocked");
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(errorText(e, "Could not block that time.")),
  });
  const removeM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (e) => toast.error(errorText(e, "Could not remove that blocked time.")),
  });

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarOff className="h-4 w-4 text-primary" /> Blocked time</h3>
      <p className="text-xs text-muted-foreground">Days off, holidays or appointments of your own. Nothing can be booked over them.</p>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming blocked time.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {blocks.map((block) => (
            <li key={block.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block">{when(block.starts_at)} – {when(block.ends_at)}</span>
                {block.reason && <span className="block text-xs text-muted-foreground">{block.reason}</span>}
              </span>
              {!readOnly && (
                <Button variant="ghost" size="icon" aria-label="Remove blocked time" onClick={() => removeM.mutate(block.id)} disabled={removeM.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e) => { e.preventDefault(); addM.mutate(); }}
        >
          <Input type="datetime-local" aria-label="Blocked from" value={start} onChange={(e) => setStart(e.target.value)} required />
          <Input type="datetime-local" aria-label="Blocked until" value={end} onChange={(e) => setEnd(e.target.value)} required />
          <Input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" size="sm" className="h-10" disabled={addM.isPending || !start || !end}>Block time</Button>
        </form>
      )}
    </section>
  );
}
