import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_INTERVAL_CHOICES, intervalLabel, renderServiceReminder } from "@/lib/service-reminders";
import { getServiceReminder, saveServiceReminder } from "@/lib/service-reminders.functions";

/** "Remind customers when they're due": one text an interval after their last completed job. */
export function ServiceReminderCard() {
  const qc = useQueryClient();
  const load = useServerFn(getServiceReminder);
  const save = useServerFn(saveServiceReminder);
  const q = useQuery({ queryKey: ["service-reminder"], queryFn: () => load() });
  const [active, setActive] = useState(false);
  const [days, setDays] = useState(90);
  const [template, setTemplate] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setActive(q.data.active);
    setDays(q.data.intervalDays);
    setTemplate(q.data.template);
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: (next: { active: boolean }) => save({ data: { active: next.active, intervalDays: days, template } }),
    onSuccess: async (_r, next) => {
      toast.success(next.active ? "Service reminders are on." : "Service reminder saved.");
      await qc.invalidateQueries({ queryKey: ["service-reminder"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });

  const d = q.data;
  const readOnly = !d?.isOwner;
  const choices: number[] = SERVICE_INTERVAL_CHOICES.includes(days as (typeof SERVICE_INTERVAL_CHOICES)[number]) ? [...SERVICE_INTERVAL_CHOICES] : [...SERVICE_INTERVAL_CHOICES, days].sort((a, b) => a - b);
  const preview = renderServiceReminder(template, { customerName: "Sam", businessName: "your business", intervalDays: days, bookingLink: "bookedsecure.com/b/…" });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Remind customers when they're due</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A while after a customer's last completed job (a car service, a clean, a detail), text them once with their own booking link. Skipped if they've already booked again, and only for customers who agreed to texts, never during quiet hours.
          </p>
        </div>
        <Switch
          checked={active}
          disabled={!d || readOnly || mutation.isPending}
          onCheckedChange={(value) => { setActive(value); mutation.mutate({ active: value }); }}
          aria-label="Remind customers when they're due"
        />
      </div>
      {d && (
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">When</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={days} disabled={readOnly} onChange={(e) => setDays(Number(e.target.value))}>
              {choices.map((x) => <option key={x} value={x}>{intervalLabel(x)} after their last job</option>)}
            </select>
            <span className="block text-xs text-muted-foreground">Suggested from your website and trade. Change it to suit how often your customers come back.</span>
          </label>
          <div className="space-y-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Message</span>
              <Textarea rows={4} value={template} disabled={readOnly} maxLength={480} onChange={(e) => setTemplate(e.target.value)} />
              <span className="block text-xs text-muted-foreground">{"{{first_name}}, {{business_name}}, {{interval}} and {{booking_link}} are filled in for each customer."}</span>
            </label>
            <p className="rounded-lg bg-secondary/60 p-2 text-xs"><span className="font-medium">Preview: </span>{preview}</p>
            {!readOnly && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ active })}>Save</Button>}
          </div>
        </div>
      )}
    </section>
  );
}
