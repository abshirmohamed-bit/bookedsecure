import { useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { initials, previewParagraphs } from "@/lib/campaign-templates";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }),
  });
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    sent: ["Sent", "bg-success/15 text-success-foreground"],
    draft: ["Draft", "bg-warning/20 text-warning-foreground"],
    scheduled: ["Scheduled", "bg-primary/12 text-primary"],
    sending: ["Sending", "bg-info/20 text-info-foreground"],
    cancelled: ["Cancelled", "bg-foreground/8 text-muted-foreground"],
  };
  const [label, style] = map[status] ?? [status, "bg-foreground/8 text-muted-foreground"];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", style)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone: "primary" | "success" | "warning" | "destructive" | "muted" | "info";
  hint?: string | undefined;
}) {
  const dot = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    info: "bg-info",
    muted: "bg-foreground/25",
  }[tone];
  return (
    <div className="glass p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** How the email looks in a customer's inbox (mirrors buildEmailHtml). */
export function EmailPreview({
  businessName,
  fromAddress,
  subject,
  bodyText,
  label = "What customers get",
}: {
  businessName: string | null;
  fromAddress: string;
  subject: string;
  bodyText: string;
  label?: string;
}) {
  const paragraphs = previewParagraphs(bodyText);
  const sender = businessName ?? "Your business";
  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/60 px-4 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="flex gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-foreground/15" />
          <span className="size-2 rounded-full bg-foreground/15" />
          <span className="size-2 rounded-full bg-foreground/15" />
        </span>
      </div>
      <div className="space-y-3 bg-white/85 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-xs font-semibold text-white">
            {initials(sender, null)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sender}</p>
            <p className="truncate text-xs text-muted-foreground">{fromAddress.trim() || "Sent from BookedSecure"}</p>
          </div>
        </div>
        <p className={cn("text-[15px] font-semibold", !subject.trim() && "text-muted-foreground/70")}>
          {subject.trim() || "Your subject line"}
        </p>
        <div className="space-y-3 text-sm leading-relaxed text-[#1f2933]">
          {paragraphs.length === 0 ? (
            <p className="text-muted-foreground/70">Your email appears here as you write it.</p>
          ) : (
            paragraphs.map((lines, i) => (
              <p key={i} className="break-words">
                {lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            ))
          )}
        </div>
        <div className="border-t border-[#e4e7eb] pt-3 text-xs text-[#6b7280]">
          Sent by {sender}. <span className="underline">Unsubscribe from these emails</span>.
        </div>
      </div>
    </div>
  );
}

function defaultScheduleValue(): string {
  const at = new Date(Date.now() + 24 * 3_600_000);
  at.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Owner approval: send the draft now, or schedule it. */
export function SendDialog({
  open,
  name,
  recipients,
  followUpDays,
  fromDeliverable,
  onClose,
  onSendNow,
  onSchedule,
}: {
  open: boolean;
  name: string;
  recipients: number;
  followUpDays: number | null;
  fromDeliverable: boolean;
  onClose: () => void;
  onSendNow: () => void;
  onSchedule: (isoWithOffset: string) => void;
}) {
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState(defaultScheduleValue);
  const scheduleIso = () => {
    const at = new Date(when);
    return Number.isNaN(at.getTime()) ? "" : at.toISOString();
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send "{name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {plural(recipients, "customer")} will get this email.
            {followUpDays ? ` Customers who haven't booked get the follow-up ${plural(followUpDays, "day")} later.` : ""}
            {fromDeliverable ? "" : " Your sending domain isn't verified yet, so emails only reach your own inbox."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["now", "later"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                mode === option ? "border-primary bg-primary/10 text-primary" : "border-white/70 bg-white/55 hover:bg-white/80",
              )}
            >
              {option === "now" ? <Send className="size-4" /> : <CalendarClock className="size-4" />}
              {option === "now" ? "Send now" : "Schedule"}
            </button>
          ))}
        </div>
        {mode === "later" && (
          <label className="block space-y-1.5 text-xs font-medium">
            Send on
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <span className="block font-normal text-muted-foreground">Uses your device's time zone.</span>
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <Button
            onClick={() => (mode === "now" ? onSendNow() : onSchedule(scheduleIso()))}
            disabled={mode === "later" && !scheduleIso()}
          >
            {mode === "now" ? "Send now" : "Schedule"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
