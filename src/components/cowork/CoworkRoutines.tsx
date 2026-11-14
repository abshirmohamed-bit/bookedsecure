import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlarmClock, Loader2, Play, Plus, Trash2, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { describeSchedule, ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX, WEEKDAY_NAMES, type RoutineFreq, type RoutineSchedule } from "@/lib/cowork-routines";
import { createCoworkRoutine, getCoworkRoutines, setCoworkChannelWatch, updateCoworkRoutine } from "@/lib/cowork-routines.functions";

const KEY = ["cowork-routines"] as const;
type Routine = Awaited<ReturnType<typeof getCoworkRoutines>>["routines"][number];

/**
 * Routines: what Co-Work does on a schedule, and the YouTube channel watch
 * that clips new uploads. Owners set up, pause, run and remove; the team reads.
 */
export function CoworkRoutines() {
  const [open, setOpen] = useState(false);
  const load = useServerFn(getCoworkRoutines);
  const q = useQuery({ queryKey: KEY, queryFn: () => load(), staleTime: 60_000, enabled: open });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Routines" title="Routines"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground">
        <AlarmClock className="size-[18px]" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
          <DialogTitle>Routines</DialogTitle>
          <DialogDescription>
            Things Co-Work does on a schedule. A routine reads your figures and prepares drafts; anything that sends, posts or books waits for your yes in its conversation. You can also just ask Co-Work: "every Monday at 8, send me last week's numbers".
          </DialogDescription>
          {q.isLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : q.isError || !q.data ? <p className="text-sm text-destructive">Routines couldn't be loaded.</p>
            : q.data.setupMissing ? <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">Routines are waiting for a database update (docs/cowork-routines.sql).</p>
            : <RoutineList routines={q.data.routines} canEdit={q.data.canEdit} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoutineList({ routines, canEdit, onClose }: { routines: Routine[]; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const update = useServerFn(updateCoworkRoutine);
  const [adding, setAdding] = useState(false);
  const act = useMutation({
    mutationFn: (v: { id: string; enabled?: boolean; runNow?: boolean; remove?: boolean }) => update({ data: v }),
    onSuccess: (_r, v) => { if (v.runNow) toast.success("It runs within about 10 minutes; the report arrives in the bell."); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That didn't work."),
  });
  const tasks = routines.filter((r) => r.kind === "task");
  const watch = routines.find((r) => r.kind === "watch_channel") ?? null;
  return (
    <div className="min-w-0 space-y-4">
      <ChannelWatch watch={watch} canEdit={canEdit} onChanged={refresh} />
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scheduled routines</h3>
          {canEdit && !adding && <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-4" /> New routine</Button>}
        </div>
        {adding && <NewRoutine onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
        {!tasks.length && !adding && <p className="text-sm text-muted-foreground">No routines yet.</p>}
        <ul className="space-y-2">
          {tasks.map((r) => (
            <li key={r.id} className="rounded-2xl border border-white/70 bg-white/45 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{r.name}{!r.enabled && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Paused</span>}</p>
                  <p className="text-xs text-muted-foreground">{r.when}{r.deliverEmail ? " · emailed" : ""}{r.enabled && r.nextRunAt ? ` · next ${new Date(r.nextRunAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{r.prompt}</p>
                  {r.lastRunAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last run {relativeTime(r.lastRunAt)}{r.lastStatus === "failed" ? " (failed)" : ""}
                      {r.threadId && <> · <Link to="/assistant/$threadId" params={{ threadId: r.threadId }} onClick={onClose} className="font-medium text-primary hover:underline">Open report</Link></>}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label="Run now" title="Run now" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, runNow: true })} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground"><Play className="size-3.5" /></button>
                    <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, enabled: !r.enabled })}>{r.enabled ? "Pause" : "Resume"}</Button>
                    <button type="button" aria-label="Remove" disabled={act.isPending} onClick={() => { if (window.confirm(`Remove the routine "${r.name}"?`)) act.mutate({ id: r.id, remove: true }); }} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-destructive"><Trash2 className="size-3.5" /></button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ChannelWatch({ watch, canEdit, onChanged }: { watch: Routine | null; canEdit: boolean; onChanged: () => void }) {
  const set = useServerFn(setCoworkChannelWatch);
  const [rights, setRights] = useState(false);
  const on = Boolean(watch?.enabled);
  const m = useMutation({
    mutationFn: (enabled: boolean) => set({ data: enabled ? { enabled, rightsConfirmed: true } : { enabled } }),
    onSuccess: (_r, enabled) => { toast.success(enabled ? "New uploads on your channel will be clipped automatically." : "The channel watch is off."); setRights(false); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That didn't work."),
  });
  return (
    <section className="rounded-2xl border border-white/70 bg-white/45 p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ff0000]/10 text-[#ff0000]"><Youtube className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Clip new YouTube uploads</p>
          <p className="text-xs text-muted-foreground">
            {on ? `On. Checks your channel every hour and clips each new video longer than 2 minutes.${watch?.lastResult ? ` ${watch.lastResult}` : ""}` : "When you post a new video on your connected YouTube channel, the Engine clips it automatically. The clips appear in Studio."}
          </p>
          {canEdit && !on && (
            <label className="mt-2 flex items-start gap-2 text-xs">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
              <span>I own the videos on my channel, or have permission to clip them.</span>
            </label>
          )}
        </div>
        {canEdit && (
          <Button type="button" size="sm" className={on ? "" : "btn-glow"} variant={on ? "ghost" : "default"} disabled={m.isPending || (!on && !rights)} onClick={() => m.mutate(!on)}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />}{on ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>
    </section>
  );
}

function NewRoutine({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const create = useServerFn(createCoworkRoutine);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [freq, setFreq] = useState<RoutineFreq>("weekly");
  const [at, setAt] = useState("08:00");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [email, setEmail] = useState(false);
  const schedule: RoutineSchedule = { freq, at, ...(freq === "weekly" ? { weekdays: [weekday] } : {}), ...(freq === "monthly" ? { dayOfMonth: day } : {}) };
  const m = useMutation({
    mutationFn: () => create({ data: { name, prompt, schedule, deliverEmail: email } }),
    onSuccess: onDone,
    onError: (e) => toast.error(e instanceof Error ? e.message : "That routine couldn't be saved."),
  });
  const ok = name.trim().length >= 2 && prompt.trim().length >= 4 && /^\d{2}:\d{2}$/.test(at);
  return (
    <form className="space-y-2 rounded-2xl border border-white/70 bg-white/60 p-3" onSubmit={(e) => { e.preventDefault(); if (ok) m.mutate(); }}>
      <Input value={name} maxLength={ROUTINE_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Monday numbers" className="h-10" />
      <Textarea value={prompt} maxLength={ROUTINE_PROMPT_MAX} onChange={(e) => setPrompt(e.target.value)} placeholder="What Co-Work should do, e.g. Tell me last week's enquiries, bookings and revenue compared with the week before, and who is still waiting for a reply." className="min-h-24 text-sm" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="How often" value={freq} onChange={(e) => setFreq(e.target.value as RoutineFreq)} className="h-9 rounded-md border border-input bg-background px-2">
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
        {freq === "weekly" && (
          <select aria-label="Day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2">
            {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        )}
        {freq === "monthly" && (
          <select aria-label="Day of the month" value={day} onChange={(e) => setDay(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2">
            {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        )}
        <Input type="time" aria-label="Time" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 w-32" />
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email me</label>
      </div>
      <p className="text-xs text-muted-foreground">{describeSchedule(schedule)}, in your business's time zone.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="btn-glow" disabled={!ok || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save routine</Button>
      </div>
    </form>
  );
}
