import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getSession } from "@/lib/app.functions";
import { getSmsDeliverySummary, reconcileSmsDelivery } from "@/lib/sms-delivery.functions";
import { Button } from "@/components/ui/button";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  quote_page: "Quote Page",
  inbound_follow_up: "Inbound follow-up",
  automation: "Automated follow-up",
  unknown: "Unattributed",
};

function percent(value: number | null): string {
  return value === null ? "Not available" : `${Math.round(value * 100)}%`;
}

/**
 * Tenant-scoped SMS delivery observability. Delivery rate counts only messages
 * with a final outcome, so pending messages are never implied to be delivered.
 */
export function SmsDeliveryPanel() {
  const fetchSession = useServerFn(getSession);
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });
  const canReconcile = session.data?.role === "owner";
  const fetchSummary = useServerFn(getSmsDeliverySummary);
  const reconcile = useServerFn(reconcileSmsDelivery);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["sms-delivery-summary"],
    queryFn: () => fetchSummary(),
  });

  const reconciliation = useMutation({
    mutationFn: () => reconcile({ data: {} }),
    onSuccess: (result) => {
      toast.success(
        `Checked ${result.checked} pending message${result.checked === 1 ? "" : "s"}; ${result.updated} updated.`,
      );
      queryClient.invalidateQueries({ queryKey: ["sms-delivery-summary"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading SMS delivery…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <section className="panel">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">SMS delivery</h2>
          <p className="text-xs text-muted-foreground">
            Provider acceptance is not delivery. Only carrier receipts move a message to Delivered.
          </p>
        </div>
        {canReconcile && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => reconciliation.mutate()}
            disabled={reconciliation.isPending}
            className="h-auto min-h-10 shrink-0 px-2.5 text-xs text-muted-foreground sm:min-h-8"
          >
            <RefreshCw className={reconciliation.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Re-check pending
          </Button>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Outbound messages" value={String(data.total)} />
        <Stat label="Accepted by provider" value={String(data.providerAccepted)} />
        <Stat label="Sent" value={String(data.sent)} />
        <Stat label="Delivered" value={String(data.delivered)} />
        <Stat label="Pending receipt" value={String(data.pending)} />
        <Stat label="Failed" value={String(data.failed)} />
        <Stat label="Undelivered" value={String(data.undelivered)} />
        <Stat label="Suppressed leads" value={String(data.suppressedLeads)} />
        <Stat label="Delivery rate" value={percent(data.deliveryRate)} hint="of final outcomes" />
        <Stat label="Failure rate" value={percent(data.failureRate)} hint="of final outcomes" />
        <Stat label="Permanent failures" value={String(data.permanentFailures)} />
        <Stat label="Temporary failures" value={String(data.temporaryFailures)} />
      </div>

      {data.finalOutcomes === 0 && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          No carrier receipts yet, so no delivery rate can be calculated.
        </p>
      )}

      <div className="divide-y divide-border border-t border-border sm:hidden">
        {data.bySource.map((row) => (
          <article key={row.source} className="p-4">
            <h3 className="font-medium">{SOURCE_LABELS[row.source] ?? row.source}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <DeliveryDatum label="Messages" value={row.total} />
              <DeliveryDatum label="Delivered" value={row.delivered} />
              <DeliveryDatum label="Failed" value={row.failed} />
              <DeliveryDatum label="Pending" value={row.pending} />
            </dl>
          </article>
        ))}
        {data.bySource.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No outbound SMS yet.</p>}
      </div>
      <div className="hidden overflow-x-auto border-t border-border sm:block">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Trigger</th>
              <th className="px-4 py-2 font-medium">Messages</th>
              <th className="px-4 py-2 font-medium">Delivered</th>
              <th className="px-4 py-2 font-medium">Failed</th>
              <th className="px-4 py-2 font-medium">Pending</th>
            </tr>
          </thead>
          <tbody>
            {data.bySource.map((row) => (
              <tr key={row.source} className="border-b border-border/60">
                <td className="px-4 py-2.5">{SOURCE_LABELS[row.source] ?? row.source}</td>
                <td className="px-4 py-2.5 tabular">{row.total}</td>
                <td className="px-4 py-2.5 tabular">{row.delivered}</td>
                <td className="px-4 py-2.5 tabular">{row.failed}</td>
                <td className="px-4 py-2.5 tabular">{row.pending}</td>
              </tr>
            ))}
            {data.bySource.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No outbound SMS yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeliveryDatum({ label, value }: { label: string; value: number }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium tabular">{value}</dd></div>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 tabular text-lg font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
