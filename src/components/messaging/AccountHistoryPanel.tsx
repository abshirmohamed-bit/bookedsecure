import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMessagingAccount, requestCancellation } from "@/lib/sms/messaging-account.functions";
import { formatAud } from "@/lib/sms/credit-packs";

/** Past credit top-ups and the cancellation request, for owners who need them. */
export function AccountHistoryPanel() {
  const fetchAccount = useServerFn(getMessagingAccount);
  const raiseCancellation = useServerFn(requestCancellation);
  const queryClient = useQueryClient();
  const [cancelNote, setCancelNote] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const { data } = useQuery({
    queryKey: ["messaging-account"],
    queryFn: () => fetchAccount(),
  });

  const cancelMutation = useMutation({
    mutationFn: () => raiseCancellation({ data: { note: cancelNote || undefined } }),
    onSuccess: (result) => {
      toast.success(
        result.alreadyOpen
          ? "You already have a cancellation request open."
          : "Cancellation request sent. We'll be in touch.",
      );
      setShowCancel(false);
      setCancelNote("");
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!data) return null;
  const isOwner = data.role === "owner";
  const openCancellation = data.requests.find(
    (request) => request.kind === "cancellation" && request.status !== "resolved",
  );

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Top-ups &amp; cancellation</h2>

      {data.topups.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {data.topups.map((topup) => (
            <li key={topup.id}>
              {new Date(topup.created_at).toLocaleDateString()} · {topup.credits} credits ·{" "}
              {formatAud(topup.amount_cents)} ·{" "}
              {topup.status === "paid"
                ? "added"
                : topup.status === "pending"
                  ? "awaiting payment"
                  : topup.status}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No credit top-ups yet.</p>
      )}

      {isOwner ? (
        <div className="mt-4 border-t border-border pt-4">
          {openCancellation ? (
            <p className="text-xs text-muted-foreground">
              Cancellation requested {new Date(openCancellation.created_at).toLocaleDateString()} —
              we&apos;ll be in touch.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setShowCancel((value) => !value)}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
            >
              Request cancellation
            </button>
          )}
          {showCancel && !openCancellation ? (
            <div className="mt-3 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Anything you&apos;d like us to know? (optional)
                </span>
                <textarea
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  rows={3}
                  value={cancelNote}
                  maxLength={1000}
                  onChange={(event) => setCancelNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="rounded-md border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive disabled:opacity-60"
              >
                {cancelMutation.isPending ? "Sending…" : "Send cancellation request"}
              </button>
              <p className="text-xs text-muted-foreground">
                Nothing is cancelled or deleted automatically. We release your number and close the
                account after confirming with you.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
