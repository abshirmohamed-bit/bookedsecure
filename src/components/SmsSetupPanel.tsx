import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSmsSetup, saveUsageLimits } from "@/lib/app.functions";
import { TelnyxReadinessPanel } from "@/components/TelnyxReadinessPanel";

const PROVIDER_LABELS: Record<string, string> = {
  telnyx: "Telnyx",
  twilio: "Twilio",
  simulated: "Simulated",
};

/** Sending numbers, monthly usage and the safety caps for this business. */
export function SmsSetupPanel() {
  const fetchSetup = useServerFn(getSmsSetup);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["sms-setup"], queryFn: () => fetchSetup() });

  const persistLimits = useServerFn(saveUsageLimits);

  const [caps, setCaps] = useState({
    monthly_segment_cap: 1000,
    monthly_ai_cost_cap: 25,
    alert_threshold_pct: 80,
    hard_block: true,
  });

  const primary = data?.senders?.find((sender) => sender.is_primary && sender.active) ?? null;
  const retired = (data?.senders ?? []).filter((sender) => sender.id !== primary?.id);

  useEffect(() => {
    if (data?.limits) {
      setCaps({
        monthly_segment_cap: data.limits.monthly_segment_cap,
        monthly_ai_cost_cap: Number(data.limits.monthly_ai_cost_cap),
        alert_threshold_pct: data.limits.alert_threshold_pct,
        hard_block: data.limits.hard_block,
      });
    }
  }, [data?.limits?.monthly_segment_cap]);

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

      <div className="mt-4 rounded-md border border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Live sending configuration
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Live sending number</dt>
            <dd className="mt-1 text-sm font-medium">{primary?.phone_number ?? "Not configured"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="mt-1 text-sm font-medium">
              {primary ? (PROVIDER_LABELS[primary.provider] ?? primary.provider) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Assigned business</dt>
            <dd className="mt-1 text-sm font-medium">{data.business?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Active</dt>
            <dd className="mt-1 text-sm font-medium">{primary?.active ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Primary</dt>
            <dd className="mt-1 text-sm font-medium">{primary?.is_primary ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Automation</dt>
            <dd className="mt-1 text-sm font-medium">
              {data.business?.automation_enabled ? "Enabled" : "Disabled"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Current usage</dt>
            <dd className="mt-1 text-sm font-medium">
              {data.usage.segments} / {caps.monthly_segment_cap} segments
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Display label</dt>
            <dd className="mt-1 text-sm font-medium">{primary?.label ?? "—"}</dd>
            <dd className="text-xs text-muted-foreground">
              Display only — does not affect routing.
            </dd>
          </div>
        </dl>
        {retired.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {retired.map((sender) => (
              <li key={sender.id}>
                {sender.phone_number} — {sender.label ?? "no label"} (
                {sender.active ? "active, not primary" : "inactive / retired"})
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Your dedicated sending number and provider are managed by BookedSecure. Contact support if
          these details appear incorrect.
        </p>
      </div>


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
      {data.role === "platform_admin" && <TelnyxReadinessPanel />}
    </section>

  );
}
