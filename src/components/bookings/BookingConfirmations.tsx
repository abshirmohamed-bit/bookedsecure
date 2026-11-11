import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { confirmationStatusText } from "@/lib/booking-email";
import { getBookingConfirmations, sendBookingConfirmationNow, setBookingAutoSend } from "@/lib/booking-email.functions";

/** One booking's confirmations: what went out by email and text, its auto-send switch, and send-now. */
export function BookingConfirmations({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getBookingConfirmations);
  const toggle = useServerFn(setBookingAutoSend);
  const send = useServerFn(sendBookingConfirmationNow);
  const key = ["booking-confirmations", jobId];
  const q = useQuery({ queryKey: key, queryFn: () => load({ data: { jobId } }) });

  const toggleMutation = useMutation({
    mutationFn: (notify: boolean) => toggle({ data: { jobId, notify } }),
    onSuccess: async (r) => { toast.success(r.notifyCustomer ? "Confirmations will go out for this booking." : "Nothing will be sent automatically for this booking."); await qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change that."),
  });
  const sendMutation = useMutation({
    mutationFn: (channel: "email" | "sms") => send({ data: { jobId, channel } }),
    onSuccess: async (r) => { (r.status === "sent" ? toast.success : toast.error)(r.reason); await qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "It couldn't be sent."),
  });

  if (q.isLoading) return <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading confirmations…</div>;
  if (!q.data) return null;
  const { ready, notifyCustomer, rows } = q.data;
  const row = (channel: "email" | "sms") => rows.find((r) => r.channel === channel);

  return (
    <div className="mt-4 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Customer confirmations</p>
          <p className="text-xs text-muted-foreground">{ready ? "Email and text sent when the booking is made." : "Start once the database update is applied."}</p>
        </div>
        <Switch checked={notifyCustomer} disabled={!ready || toggleMutation.isPending} onCheckedChange={(v) => toggleMutation.mutate(v)} aria-label="Send confirmations automatically for this booking" />
      </div>
      {ready ? (
        <ul className="mt-3 space-y-2">
          {(["email", "sms"] as const).map((channel) => {
            const r = row(channel);
            const Icon = channel === "email" ? Mail : MessageSquare;
            return (
              <li key={channel} className="flex items-start gap-2 text-xs">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${r?.status === "failed" ? "text-destructive" : ""}`}>{r ? confirmationStatusText(r) : channel === "email" ? "Email not sent" : "Text not sent"}</p>
                  <p className="break-words text-muted-foreground">{r ? [r.recipient, r.status !== "sent" ? r.reason : null, new Date(r.updatedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })].filter(Boolean).join(" · ") : "Nothing recorded for this booking."}</p>
                </div>
                {r?.status !== "sent" ? (
                  <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={sendMutation.isPending} onClick={() => sendMutation.mutate(channel)}>
                    {sendMutation.isPending && sendMutation.variables === channel ? <Loader2 className="size-3.5 animate-spin" /> : "Send now"}
                  </Button>
                ) : channel === "email" ? (
                  <Button size="sm" variant="ghost" className="h-8 shrink-0" disabled={sendMutation.isPending} onClick={() => sendMutation.mutate("email")}>Resend</Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
