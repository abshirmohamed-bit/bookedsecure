import { useMutation } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendFeedback } from "@/lib/feedback.functions";
import {
  FEEDBACK_KIND_HINTS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * Rail feedback control. Opens a small two-choice sheet: request a feature or
 * report an issue. The signed-in business and person are recorded server-side,
 * so nothing identifying has to be typed in.
 */
export function FeedbackButton({ rail = false }: { rail?: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [message, setMessage] = useState("");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const submit = useServerFn(sendFeedback);

  const mutation = useMutation({
    mutationFn: (input: { kind: FeedbackKind; message: string }) =>
      submit({ data: { ...input, pagePath: pathname } }),
    onSuccess: () => {
      toast.success("Thanks — that has been sent to the BookedSecure team.");
      close();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That could not be sent. Please try again."),
  });

  const close = () => {
    setOpen(false);
    setKind(null);
    setMessage("");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        size={rail ? "icon" : "sm"}
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Send feedback"
        aria-label="Send feedback"
      >
        <MessageSquarePlus />
        {rail ? null : <span className="ml-1.5">Feedback</span>}
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4">
              <button
                type="button"
                aria-label="Close feedback"
                className="absolute inset-0"
                onClick={close}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Send feedback"
                className="relative flex w-full max-w-md flex-col gap-3 rounded-t-2xl border border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-base font-semibold">Send feedback</h2>
                    <p className="text-xs text-muted-foreground">
                      Your business details are attached automatically.
                    </p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label="Close" onClick={close}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-2">
                  {FEEDBACK_KINDS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setKind(option)}
                      aria-pressed={kind === option}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                        kind === option
                          ? "border-primary bg-primary/10 font-semibold text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {FEEDBACK_KIND_LABELS[option]}
                    </button>
                  ))}
                </div>

                {kind ? (
                  <div className="grid gap-2">
                    <label htmlFor="feedback-message" className="text-xs font-medium text-muted-foreground">
                      {FEEDBACK_KIND_HINTS[kind]}
                    </label>
                    <textarea
                      id="feedback-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      rows={5}
                      maxLength={4000}
                      className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Tell us as much detail as you like…"
                    />
                    <Button
                      type="button"
                      className="min-h-11"
                      disabled={message.trim().length < 5 || mutation.isPending}
                      onClick={() => mutation.mutate({ kind, message: message.trim() })}
                    >
                      {mutation.isPending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
