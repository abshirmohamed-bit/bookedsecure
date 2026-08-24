import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSmsSetup, saveSender, saveUsageLimits } from "@/lib/app.functions";

/** Sending numbers, monthly usage and the safety caps for this business. */
export function SmsSetupPanel() {
  const fetchSetup = useServerFn(getSmsSetup);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["sms-setup"], queryFn: () => fetchSetup() });

  const persistSender = useServerFn(saveSender);
  const persistLimits = useServerFn(saveUsageLimits);

  const [senderNumber, setSenderNumber] = useState("");
  const [senderLabel, setSenderLabel] = useState("");
  const [caps, setCaps] = useState({
    monthly_segment_cap: 2000,
    monthly_ai_cost_cap: 25,
    alert_threshold_pct: 80,
    hard_block: true,
  });

  const primary = data?.senders?.find((sender) => sender.is_primary) ?? data?.senders?.[0] ?? null;

  useEffect(() => {
    if (primary) {
      setSenderNumber(primary.phone_number);
      setSenderLabel(primary.label ?? "");
    }
    if (data?.limits) {
      setCaps({
        monthly_segment_cap: data.limits.monthly_segment_cap,
        monthly_ai_cost_cap: Number(data.limits.monthly_ai_cost_cap),
        alert_threshold_pct: data.limits.alert_threshold_pct,
        hard_block: data.limits.hard_block,
      });
    }
  }, [primary?.id, data?.limits?.monthly_segment_cap]);

  const senderMutation = useMutation({
    mutationFn: () =>
      persistSender({
        data: {
          id: primary?.id ?? null,
          phone_number: senderNumber,
          label: senderLabel || null,
          active: true,
        },
      }),
    onSuccess: () => {
      toast.success("Sender number saved");
      void queryClient.invalidateQueries({ queryKey: ["sms-setup"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const limitsMutation = useMutation({
    mutationFn: () => persistLimits({ data: caps }),
    onSuccess: () => {
      toast.success("Safety caps saved");
      void queryClient.invalidateQueries({ queryKey: ["sms-setup"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !data) return null;
  const readOnly = data.role !== "owner";
  const usedPct =
    caps.monthly_segment_cap > 0
      ? Math.min(100, Math.round((data.usage.segments / caps.monthly_segment_cap) * 100))
      : 0;

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">SMS number &amp; usage</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every message is sent from this business&apos;s own dedicated number. Replies and delivery
        receipts are matched back to this number, so numbers are never shared between businesses.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Dedicated sender number</span>
          <input
            className="w-full rounded-md border border-border bg-input px-3 py-2"
            value={senderNumber}
            onChange={(event) => setSenderNumber(event.target.value)}
            disabled={readOnly}
            placeholder="+61480000000"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Label</span>
          <input
            className="w-full rounded-md border border-border bg-input px-3 py-2"
            value={senderLabel}
            onChange={(event) => setSenderLabel(event.target.value)}
            disabled={readOnly}
            placeholder="Glocast dedicated number"
          />
        </label>
      </div>
      {!readOnly && (
        <button
          type="button"
          className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          onClick={() => senderMutation.mutate()}
          disabled={senderMutation.isPending}
        >
          {senderMutation.isPending ? "Saving…" : "Save sender number"}
        </button>
      )}

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Segments this month</dt>
          <dd className="mt-1 text-lg font-semibold">
            {data.usage.segments}
            <span className="text-xs text-muted-foreground"> / {caps.monthly_segment_cap}</span>
          </dd>
          <dd className="text-xs text-muted-foreground">{usedPct}% of cap</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">AI spend this month</dt>
          <dd className="mt-1 text-lg font-semibold">${data.usage.aiCost.toFixed(2)}</dd>
          <dd className="text-xs text-muted-foreground">cap ${caps.monthly_ai_cost_cap}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Sending numbers</dt>
          <dd className="mt-1 text-lg font-semibold">{data.senders.length}</dd>
          <dd className="text-xs text-muted-foreground">
            {primary ? `primary ${primary.phone_number}` : "none configured"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Monthly segment cap</span>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-input px-3 py-2"
            value={caps.monthly_segment_cap}
            onChange={(event) =>
              setCaps({ ...caps, monthly_segment_cap: Number(event.target.value) })
            }
            disabled={readOnly}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Monthly AI cap ($)</span>
          <input
            type="number"
            step="0.5"
            className="w-full rounded-md border border-border bg-input px-3 py-2"
            value={caps.monthly_ai_cost_cap}
            onChange={(event) =>
              setCaps({ ...caps, monthly_ai_cost_cap: Number(event.target.value) })
            }
            disabled={readOnly}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Alert at (%)</span>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-input px-3 py-2"
            value={caps.alert_threshold_pct}
            onChange={(event) =>
              setCaps({ ...caps, alert_threshold_pct: Number(event.target.value) })
            }
            disabled={readOnly}
          />
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input
            type="checkbox"
            checked={caps.hard_block}
            onChange={(event) => setCaps({ ...caps, hard_block: event.target.checked })}
            disabled={readOnly}
          />
          <span className="text-muted-foreground">Stop automation at cap</span>
        </label>
      </div>
      {!readOnly && (
        <button
          type="button"
          className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
          onClick={() => limitsMutation.mutate()}
          disabled={limitsMutation.isPending}
        >
          {limitsMutation.isPending ? "Saving…" : "Save safety caps"}
        </button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Opt-outs and inbound replies are always recorded, even when a cap has stopped outbound
        automation.
      </p>
    </section>
  );
}
