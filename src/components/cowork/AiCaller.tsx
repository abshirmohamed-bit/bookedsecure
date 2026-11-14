import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AudioLines, CalendarClock, CloudUpload, Loader2, Phone, PhoneIncoming, PhoneOutgoing, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { READINESS_VALUES } from "@/lib/ai-analysis-contract";
import { CAPTURE_KEYS, READINESS_LABEL, callLength, captureLabels, displayMobile, type Captured, type CaptureKey } from "@/lib/lead-calls";
import { getLeadCall, getLeadCalls, logLeadCall, saveLeadCall } from "@/lib/lead-calls.functions";

const KEY = ["lead-calls"] as const;
type CallsData = Awaited<ReturnType<typeof getLeadCalls>>;
type Call = CallsData["calls"][number];
type Detail = Awaited<ReturnType<typeof getLeadCall>>;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");
const initials = (name: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * AI Caller: calls with leads and what they said, read into the lead's own
 * fields for the owner to check and save. Until live calling (Telnyx) is
 * connected, calls are logged after the owner makes them; nothing here is a
 * simulated call.
 */
export function AiCallerCard({ compact = false, onAsk }: { compact?: boolean; onAsk: (prompt: string) => void }) {
  const load = useServerFn(getLeadCalls);
  const q = useQuery({ queryKey: KEY, queryFn: () => load(), staleTime: 60_000 });
  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Detail | null>(null);
  const data = q.data;
  const calls = data?.calls ?? [];
  const shown = calls.slice(0, compact ? 2 : 3);
  return (
    <section aria-label="AI Caller" className="rounded-2xl border border-[#D0E3F0] bg-gradient-to-br from-[#EBF4FA] to-[#F4F9FD] p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/80 text-primary shadow-sm"><AudioLines className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight">AI Caller</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {data?.calling ? "Live calling is on" : "Live calling isn't connected yet: log calls you make"}
          </p>
        </div>
        <Button type="button" size="sm" className="btn-glow shrink-0 rounded-full" disabled={data?.setupMissing} onClick={() => setLogging(true)}>
          <Plus className="size-3.5" aria-hidden="true" />Log a call
        </Button>
      </div>

      {q.isLoading ? null : data?.setupMissing ? (
        <p className="mt-2 text-xs text-muted-foreground">The AI Caller is waiting for a database update (docs/lead-calls.sql).</p>
      ) : !calls.length ? (
        <p className="mt-2 text-xs text-muted-foreground">Paste your notes or the transcript after a call. Co-Work fills in the customer's details for you to check and save to the lead.</p>
      ) : (
        <ul className={`mt-2.5 grid gap-1.5 ${compact ? "" : "sm:grid-cols-3"}`}>
          {shown.map((c) => <CallRow key={c.id} call={c} onOpen={() => setOpenId(c.id)} />)}
        </ul>
      )}

      {logging ? <LogCallDialog onClose={() => setLogging(false)} onLogged={(d) => { setLogging(false); setOpened(d); }} /> : null}
      {openId || opened ? (
        <CallPanel callId={openId ?? opened!.id} initial={opened} subjectLabel={data?.subjectLabel ?? "Job"}
          onClose={() => { setOpenId(null); setOpened(null); }} onAsk={onAsk} />
      ) : null}
    </section>
  );
}

function CallRow({ call, onOpen }: { call: Call; onOpen: () => void }) {
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2 rounded-xl border border-white/80 bg-white/70 p-2 text-left transition hover:bg-white">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials(call.leadName)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-xs font-semibold">
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{call.leadName || displayMobile(call.phoneNumber) || "Customer"}</span>
          </span>
          <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{call.summary || "No summary"}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {relativeTime(call.createdAt)}
            <span className={`rounded-full px-1.5 py-px font-medium ${call.saved ? "bg-[#DCFCE7] text-[#15803D]" : "bg-amber-100 text-amber-800"}`}>{call.saved ? "Saved" : "To check"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function LogCallDialog({ onClose, onLogged }: { onClose: () => void; onLogged: (d: Detail) => void }) {
  const qc = useQueryClient();
  const log = useServerFn(logLeadCall);
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [minutes, setMinutes] = useState("");
  const m = useMutation({
    mutationFn: () => log({ data: { text, direction, ...(Number(minutes) > 0 ? { durationMinutes: Number(minutes) } : {}) } }),
    onSuccess: (d) => { void qc.invalidateQueries({ queryKey: KEY }); onLogged(d); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !m.isPending) onClose(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto">
        <DialogTitle>Log a call</DialogTitle>
        <DialogDescription>Paste your notes or the transcript. Write "Me:" and "Customer:" at the start of lines if you have them. Co-Work reads it and fills in the customer's details; nothing is saved to a lead until you check it.</DialogDescription>
        <div className="flex flex-wrap gap-2">
          {([["outbound", "I called them", PhoneOutgoing], ["inbound", "They called me", PhoneIncoming]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={() => setDirection(value)} aria-pressed={direction === value}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${direction === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              <Icon className="size-3.5" aria-hidden="true" />{label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Minutes <Input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9.]/g, ""))} className="h-8 w-16" />
          </label>
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} className="min-h-48 text-sm"
          placeholder={"Me: Hi, it's about the quote you asked for.\nCustomer: Yes, I'm Sarah, I've got a 2022 BMW X5 needing a full interior detail.\nMe: When suits you?\nCustomer: Friday morning, 10 if you can. I'm in Parramatta, 0412 345 678."} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button type="button" className="btn-glow" disabled={text.trim().length < 10 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="size-4 animate-spin" /> : null}{m.isPending ? "Reading the call…" : "Read the call"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CallPanel({ callId, initial, subjectLabel, onClose, onAsk }: {
  callId: string; initial: Detail | null; subjectLabel: string; onClose: () => void; onAsk: (prompt: string) => void;
}) {
  const load = useServerFn(getLeadCall);
  const q = useQuery({ queryKey: [...KEY, callId], queryFn: () => load({ data: { callId } }), initialData: initial ?? undefined });
  const call = q.data;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-5xl overflow-y-auto border-[#D0E3F0] bg-gradient-to-br from-[#EBF4FA] to-[#F4F9FD] p-0">
        <DialogTitle className="sr-only">Call with {call?.leadName || call?.phoneNumber || "a customer"}</DialogTitle>
        <DialogDescription className="sr-only">The call transcript and the customer details read from it.</DialogDescription>
        {!call ? (
          <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <CallBody call={call} subjectLabel={subjectLabel} onClose={onClose} onAsk={onAsk} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CallBody({ call, subjectLabel, onClose, onAsk }: { call: Detail; subjectLabel: string; onClose: () => void; onAsk: (prompt: string) => void }) {
  const labels = captureLabels(subjectLabel);
  const length = callLength(call.durationS);
  const live = call.status === "live" || call.status === "ringing";
  return (
    <div className="p-4 sm:p-5">
      <header className="flex items-center gap-3 border-b border-[#D0E3F0] pb-3 pr-8">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/80 text-primary shadow-sm"><AudioLines className="size-5" aria-hidden="true" /></span>
        <h2 className="flex-1 whitespace-nowrap font-heading text-lg font-semibold sm:text-xl">AI Caller</h2>
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap rounded-full border border-[#D0E3F0] bg-white/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {live ? <><span className="size-1.5 animate-pulse rounded-full bg-red-500" />LIVE</> : call.provider === "logged" ? <>Logged<span className="hidden sm:inline"> call</span></> : "Completed"}
          {length ? <span className="truncate">{` • ${length}`}</span> : null}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2 py-3 text-sm">
        <Phone className="size-4 text-primary" aria-hidden="true" />
        <span className="font-medium">{displayMobile(call.phoneNumber) || "No number yet"}</span>
        <span className="text-muted-foreground">({call.campaign || (call.direction === "inbound" ? "They called" : "You called")})</span>
        <span className="ml-auto text-xs text-muted-foreground">{relativeTime(call.createdAt)}</span>
        {call.leadId ? <Link to="/leads/$leadId" params={{ leadId: call.leadId }} onClick={onClose} className="text-xs font-medium text-primary hover:underline">Open lead</Link> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-2xl border border-[#D0E3F0] bg-white/55 p-3">
          <h3 className="text-base font-semibold">{call.hasRecording ? "Transcript & recording" : "Transcript"}</h3>
          {call.summary ? <p className="mt-1 rounded-xl bg-white/70 p-2 text-xs leading-relaxed text-foreground/80">{call.summary}</p> : null}
          <ol className="mt-2 max-h-[52dvh] space-y-2 overflow-y-auto pr-1">
            {call.transcript.length ? call.transcript.map((l, i) => <Bubble key={i} line={l} name={call.leadName} logged={call.provider === "logged"} />)
              : <li className="text-xs text-muted-foreground">No transcript.</li>}
          </ol>
        </section>
        <ProfileForm call={call} labels={labels} onClose={onClose} onAsk={onAsk} />
      </div>
    </div>
  );
}

function Bubble({ line, name, logged }: { line: Detail["transcript"][number]; name: string | null; logged: boolean }) {
  if (line.role === "note") return <li className="px-1 text-xs italic text-muted-foreground">{line.text}</li>;
  const agent = line.role === "agent";
  return (
    <li className="flex items-start gap-2">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${agent ? "bg-[#DCEBF6] text-primary" : "bg-amber-100 text-amber-800"}`}>
        {agent ? <AudioLines className="size-3.5" aria-hidden="true" /> : initials(name)}
      </span>
      <div className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm shadow-sm ${agent ? "border-[#D0E3F0] bg-[#F1F7FC]" : "border-border/60 bg-white"}`}>
        <p className="text-xs font-semibold">{agent ? (logged ? "You" : "AI Agent") : name || "Customer"}</p>
        <p className="leading-snug">{line.text}</p>
      </div>
    </li>
  );
}

const FIELDS: (CaptureKey | "preferred_time")[] = [...CAPTURE_KEYS, "preferred_time"];

function ProfileForm({ call, labels, onClose, onAsk }: {
  call: Detail; labels: Record<CaptureKey | "preferred_time", string>; onClose: () => void; onAsk: (prompt: string) => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveLeadCall);
  // The mobile is shown the way people write it; the server normalises it again on save.
  const baseline = useMemo<Captured>(() => ({ ...call.captured, ...(call.captured.mobile_number ? { mobile_number: displayMobile(call.captured.mobile_number) } : {}) }), [call.captured]);
  const [form, setForm] = useState<Captured>(baseline);
  useEffect(() => { setForm(baseline); }, [call.id, baseline]);
  const filled = useMemo(() => FIELDS.filter((k) => Boolean(baseline[k])), [baseline]);
  const m = useMutation({
    mutationFn: () => save({ data: { callId: call.id, fields: Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string> } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(r.created ? `${r.name} added to your leads.` : `${r.name}'s lead is updated.`);
      if (r.preferredTime) {
        toast(`${r.name} would like ${r.preferredTime}.`, {
          action: { label: "Book with Co-Work", onClick: () => { onClose(); onAsk(`Book ${r.name} for ${r.preferredTime}. Show me the booking before anything is saved.`); } },
          duration: 12_000,
        });
      }
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const set = (k: CaptureKey | "preferred_time", v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <section className="rounded-2xl border border-[#D0E3F0] bg-white/55 p-3">
      <h3 className="text-base font-semibold">Prospect profile</h3>
      <p className="text-[11px] text-muted-foreground">Filled from the call ({filled.length} of {FIELDS.length}). Check and change anything before saving.</p>
      <div className="mt-2 space-y-2">
        {FIELDS.map((k) => {
          const value = form[k] ?? "";
          const captured = baseline[k];
          const state = captured && value === captured ? "Captured" : value && value !== (captured ?? "") ? "Edited" : null;
          return (
            <label key={k} className="block">
              <span className="mb-0.5 flex items-center justify-between text-xs font-medium">
                {labels[k]}
                {state ? <span className={`rounded-full px-2 py-px text-[10px] font-medium ${state === "Captured" ? "bg-[#DCFCE7] text-[#15803D]" : "bg-primary/10 text-primary"}`}>{state}</span> : null}
              </span>
              {k === "readiness_classification" ? (
                <select value={value} onChange={(e) => set(k, e.target.value)} className="h-9 w-full rounded-xl border border-input bg-white px-2 text-sm">
                  <option value="">Not set</option>
                  {READINESS_VALUES.map((r) => <option key={r} value={r}>{READINESS_LABEL[r]}</option>)}
                </select>
              ) : k === "main_concerns" ? (
                <Textarea value={value} onChange={(e) => set(k, e.target.value)} className="min-h-16 rounded-xl bg-white text-sm" />
              ) : (
                <Input value={value} onChange={(e) => set(k, e.target.value)} inputMode={k === "mobile_number" ? "tel" : k === "email" ? "email" : "text"} className="h-9 rounded-xl bg-white text-sm" />
              )}
              {k === "preferred_time" ? <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="size-3" aria-hidden="true" />Becomes a booking you confirm in Co-Work, not a lead field.</span> : null}
            </label>
          );
        })}
      </div>
      <Button type="button" className="mt-3 h-11 w-full rounded-full bg-[#2E749E] text-white hover:bg-[#2A6890]" disabled={m.isPending} onClick={() => m.mutate()}>
        {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" aria-hidden="true" />}
        {call.saved ? "Save changes to the lead" : "Save to CRM"}
      </Button>
    </section>
  );
}
