import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, MailCheck, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  BOOKING_EMAIL_FIELDS,
  type BookingEmailSettings,
  checkBookingEmail,
  confirmationStatusText,
  DEFAULT_BOOKING_EMAIL,
  EMAIL_IMAGE_TYPES,
  fillBookingEmail,
  MAX_EMAIL_IMAGE_BYTES,
  sampleBookingEmailValues,
} from "@/lib/booking-email";
import { getBookingEmail, saveBookingEmail, sendTestBookingEmail, uploadBookingEmailImage } from "@/lib/booking-email.functions";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("That picture could not be read."));
    r.readAsDataURL(file);
  });
}

/**
 * Booking confirmations: the email every new booking sends (the business's own
 * HTML, merge fields, hosted pictures), a live preview, a test send, and the
 * log of what went out on email and text.
 */
export function BookingConfirmationCard() {
  const qc = useQueryClient();
  const load = useServerFn(getBookingEmail);
  const save = useServerFn(saveBookingEmail);
  const test = useServerFn(sendTestBookingEmail);
  const upload = useServerFn(uploadBookingEmailImage);
  const q = useQuery({ queryKey: ["booking-email"], queryFn: () => load() });
  const [form, setForm] = useState<BookingEmailSettings>(DEFAULT_BOOKING_EMAIL);
  const [tab, setTab] = useState<"preview" | "html">("preview");
  const html = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { if (q.data) setForm(q.data.settings); }, [q.data]);

  const d = q.data;
  const readOnly = !d?.canEdit;
  const problems = useMemo(() => checkBookingEmail(form), [form]);
  const dirty = Boolean(d) && JSON.stringify(form) !== JSON.stringify(d?.settings);
  const values = sampleBookingEmailValues(d?.business.name ?? "", d?.business.phone ?? "");
  const previewHtml = useMemo(() => fillBookingEmail(form.html, values, "html"), [form.html, values]);
  const previewSubject = fillBookingEmail(form.subject, values, "text");

  const saveMutation = useMutation({
    mutationFn: (next: BookingEmailSettings) => save({ data: next }),
    onSuccess: async () => { toast.success("Confirmation email saved."); await qc.invalidateQueries({ queryKey: ["booking-email"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });
  const testMutation = useMutation({
    mutationFn: () => test({ data: form }),
    onSuccess: (r) => toast.success(`Test sent to ${r.sentTo}.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The test couldn't be sent."),
  });
  const uploadMutation = useMutation({
    mutationFn: async (picked: File) => {
      if (!(picked.type in EMAIL_IMAGE_TYPES)) throw new Error("Use a JPG, PNG, GIF or WebP picture.");
      if (picked.size > MAX_EMAIL_IMAGE_BYTES) throw new Error("Pictures for emails must be under 2 MB.");
      return upload({ data: { contentType: picked.type as keyof typeof EMAIL_IMAGE_TYPES, dataBase64: await readBase64(picked) } });
    },
    onSuccess: (r) => {
      insert(`<img src="${r.url}" alt="" width="560" style="display:block;max-width:100%;height:auto;border:0;">`);
      setTab("html");
      toast.success("Picture added where the cursor was. It's hosted by BookedSecure.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The picture couldn't be added."),
  });

  function insert(text: string) {
    const el = html.current;
    setForm((f) => {
      const at = el ? el.selectionStart : f.html.length;
      const end = el ? el.selectionEnd : at;
      return { ...f, html: f.html.slice(0, at) + text + f.html.slice(end) };
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Booking confirmations</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every new booking emails the customer this confirmation and texts them the standard confirmation, however it was booked.
            Turn it off for one booking from that booking in the calendar, or when you schedule it.
          </p>
        </div>
        <Switch
          checked={form.enabled}
          disabled={!d || readOnly || saveMutation.isPending}
          onCheckedChange={(value) => { const next = { ...form, enabled: value }; setForm(next); saveMutation.mutate(next); }}
          aria-label="Send confirmation emails"
        />
      </div>

      {d && !d.ready ? (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Confirmation emails start once the database update (migration 0061) is applied. You can design the email now.</p>
      ) : null}

      {d && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Subject</span>
              <Input value={form.subject} disabled={readOnly} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Replies go to</span>
              <Input value={form.replyTo} disabled={readOnly} type="email" placeholder={d.myEmail ?? "your email"} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} />
              <span className="block text-xs text-muted-foreground">Sent from {d.business.name || "your business"} &lt;bookings@bookedsecure.com&gt;. Empty means replies go to the owner's sign-in email.</span>
            </label>
            <div className="space-y-1 text-sm">
              <span className="font-medium">Merge fields</span>
              <div className="flex flex-wrap gap-1">
                {BOOKING_EMAIL_FIELDS.map((f) => (
                  <button key={f.key} type="button" disabled={readOnly} title={`${f.label}, e.g. ${f.sample}`} onClick={() => { insert(`{{${f.key}}}`); setTab("html"); }}
                    className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[11px] hover:border-primary disabled:opacity-50">{`{{${f.key}}}`}</button>
                ))}
              </div>
              <span className="block text-xs text-muted-foreground">Click to insert at the cursor. Missing address or price reads "To be confirmed".</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" aria-label="Choose a picture"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadMutation.mutate(f); }} />
              <Button size="sm" variant="outline" disabled={readOnly || uploadMutation.isPending} onClick={() => file.current?.click()}>
                {uploadMutation.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <ImagePlus className="mr-1.5 size-4" />}Add a picture
              </Button>
              <Button size="sm" variant="outline" disabled={readOnly} onClick={() => setForm({ ...form, subject: DEFAULT_BOOKING_EMAIL.subject, html: DEFAULT_BOOKING_EMAIL.html })}>
                <RotateCcw className="mr-1.5 size-4" />Use the built-in design
              </Button>
            </div>
            {problems.length ? <ul className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!dirty || problems.length > 0 || saveMutation.isPending} onClick={() => saveMutation.mutate(form)}>
                  {saveMutation.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}Save
                </Button>
                <Button size="sm" variant="outline" disabled={problems.length > 0 || testMutation.isPending} onClick={() => testMutation.mutate()}>
                  {testMutation.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}Send me a test
                </Button>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 text-xs">
              {(["preview", "html"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-md px-3 py-1 font-medium ${tab === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{t === "preview" ? "Preview" : "HTML"}</button>
              ))}
            </div>
            {tab === "preview" ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <p className="truncate border-b border-border bg-secondary/40 px-3 py-2 text-xs"><span className="text-muted-foreground">Subject: </span>{previewSubject}</p>
                {/* Sandboxed: the owner's HTML never runs in the app. */}
                <iframe title="Email preview" sandbox="" srcDoc={previewHtml} className="h-[28rem] w-full bg-white" />
              </div>
            ) : (
              <textarea ref={html} value={form.html} disabled={readOnly} spellCheck={false} aria-label="Email HTML"
                onChange={(e) => setForm({ ...form, html: e.target.value })}
                className="h-[30rem] w-full rounded-xl border border-input bg-background p-3 font-mono text-[11px] leading-relaxed outline-none focus:ring-2 focus:ring-primary/40" />
            )}
          </div>
        </div>
      )}

      {d && d.log.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-muted-foreground">Recently sent</h3>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-xs">
            {d.log.map((row) => (
              <li key={`${row.jobId}-${row.channel}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 font-medium ${row.status === "sent" ? "bg-emerald-50 text-emerald-700" : row.status === "failed" ? "bg-red-50 text-red-700" : "bg-secondary text-muted-foreground"}`}>{confirmationStatusText(row)}</span>
                <span className="font-medium">{row.customer ?? "Customer"}</span>
                {row.scheduledAt ? <span className="text-muted-foreground">booking {when(row.scheduledAt)}</span> : null}
                {row.reason && row.status !== "sent" ? <span className="text-muted-foreground">· {row.reason}</span> : null}
                <span className="ml-auto text-muted-foreground">{when(row.updatedAt)}{row.attempts > 1 ? ` · ${row.attempts} tries` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
