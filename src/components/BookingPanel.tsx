import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  confirmLeadBooking,
  getBookingOptions,
  offerBookingSlots,
  selectBookingSlot,
} from "@/lib/app.functions";

/**
 * Owner-facing booking workflow. Every time shown here was computed by the
 * server from tenant availability. never typed in, and never produced by the
 * AI. Confirming is the only way a lead becomes Booked, and the server
 * revalidates the slot at that moment.
 */
type InboundMessage = { id: string; direction: string; body: string; created_at: string };

export function BookingPanel({
  leadId,
  inboundMessages,
  readOnly,
  onDone,
}: {
  leadId: string;
  inboundMessages: InboundMessage[];
  readOnly: boolean;
  onDone: () => void;
}) {
  const fetchOptions = useServerFn(getBookingOptions);
  const offer = useServerFn(offerBookingSlots);
  const select = useServerFn(selectBookingSlot);
  const confirm = useServerFn(confirmLeadBooking);
  const queryClient = useQueryClient();
  const [messageId, setMessageId] = useState<string>(inboundMessages[0]?.id ?? "");

  const booking = useQuery({
    queryKey: ["booking", leadId],
    queryFn: () => fetchOptions({ data: { leadId } }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["booking", leadId] });
    onDone();
  };

  const offerMutation = useMutation({
    mutationFn: () => offer({ data: { leadId } }),
    onSuccess: (result) => {
      if (result.sent) toast.success("Appointment times sent to the customer");
      else toast.error(result.reason ?? "Times were not sent");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectMutation = useMutation({
    mutationFn: (offerId: string) => select({ data: { leadId, offerId, messageId } }),
    onSuccess: (result) => {
      if (result.ok && result.automaticallyBooked)
        toast.success("Booked and confirmed by SMS");
      else if (result.ok) toast.success("Customer choice recorded");
      else toast.error(result.reason ?? "Could not record that choice");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (offerId: string) => confirm({ data: { leadId, offerId } }),
    onSuccess: (result) => {
      if (result.ok)
        toast.success(result.alreadyConfirmed ? "Already booked" : "Booked and confirmed by SMS");
      else toast.error(result.reason ?? "Booking was blocked");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = booking.data;
  const offers = data?.offers ?? [];
  const openOffers = offers.filter((row) => row.status === "offered");
  const accepted = offers.find((row) => row.status === "accepted");
  const confirmed = offers.find((row) => row.status === "confirmed");

  const label = (iso: string, timezone: string) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Appointment</h2>

      {booking.isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading times…</p>}

      {data && !data.config.active && (
        <p className="mt-2 text-xs text-muted-foreground">
          Bookable availability is switched off. Turn it on in Business settings to offer appointment
          times.
        </p>
      )}

      {confirmed && (
        <p className="mt-2 rounded-md border border-border bg-secondary/40 p-2 text-xs">
          Booked for {label(confirmed.slot_start, confirmed.timezone)}. Confirmation SMS sent.
        </p>
      )}

      {data && data.config.active && !confirmed && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Next available: {data.slots.length === 0 ? "none in the current window" : null}
            {data.slots.map((slot) => slot.label).join(" · ")}
          </p>

          {!readOnly && (
            <button
              onClick={() => offerMutation.mutate()}
              disabled={offerMutation.isPending || data.slots.length === 0}
              className="mt-3 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              {offerMutation.isPending ? "Sending…" : "Send these times to the customer"}
            </button>
          )}

          {openOffers.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium">Which time did the customer choose?</p>
              <label className="block text-xs text-muted-foreground">
                Their reply
                <select
                  value={messageId}
                  onChange={(event) => setMessageId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">Select the customer reply…</option>
                  {inboundMessages.map((message) => (
                    <option key={message.id} value={message.id}>
                      {new Date(message.created_at).toLocaleString("en-AU")} -{" "}
                      {message.body.slice(0, 40)}
                    </option>
                  ))}
                </select>
              </label>
              {openOffers.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>{label(row.slot_start, row.timezone)}</span>
                  <button
                    onClick={() => selectMutation.mutate(row.id)}
                    disabled={readOnly || !messageId || selectMutation.isPending}
                    className="rounded-md border border-input px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    They chose this
                  </button>
                </div>
              ))}
            </div>
          )}

          {accepted && (
            <div className="mt-4 rounded-md border border-border p-3">
              <p className="text-xs">
                Customer chose {label(accepted.slot_start, accepted.timezone)}. Confirming books the
                job and sends the confirmation SMS.
              </p>
              <button
                onClick={() => confirmMutation.mutate(accepted.id)}
                disabled={readOnly || confirmMutation.isPending}
                className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {confirmMutation.isPending ? "Booking…" : "Confirm booking"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
