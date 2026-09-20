import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getQuoteFunnel } from "@/lib/quote-funnel.functions";

/**
 * Quote-page funnel: where visitors from your link actually stop.
 * Every number is measured. opens come from recorded page opens and bookings
 * come from confirmed jobs, never from the conversation record.
 */
export function QuoteFunnelPanel() {
  const fetchFunnel = useServerFn(getQuoteFunnel);
  const { data, isLoading, error } = useQuery({
    queryKey: ["quote-funnel", 30],
    queryFn: () => fetchFunnel({ data: { days: 30 } }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading quote page figures…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const top = data.steps[0]?.count ?? 0;

  return (
    <section className="panel overflow-hidden">
      <h2 className="section-heading">Quote page. last {data.days} days</h2>
      <div className="space-y-2 p-4">
        {data.steps.map((step) => (
          <div key={step.stage} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-muted-foreground sm:w-40">{step.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${top ? (step.count / top) * 100 : 0}%` }}
              />
            </div>
            <span className="w-8 shrink-0 tabular text-right text-xs">{step.count}</span>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border p-4 text-sm sm:grid-cols-4">
        <Datum label="Finished enquiries" value={String(data.finishedIntake)} />
        <Datum label="Booked a time" value={String(data.booked)} />
        <Datum label="Went quiet" value={String(data.abandoned)} />
        <Datum label="Still in progress" value={String(data.stillActive)} />
      </dl>

      {data.dropOffs.length > 0 && (
        <div className="border-t border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground">Where people stop</p>
          <ul className="mt-2 space-y-1 text-sm">
            {data.dropOffs.slice(0, 4).map((step) => (
              <li key={step.stage} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{step.label}</span>
                <span className="tabular shrink-0">{step.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.bySource.length > 0 && (
        <div className="border-t border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground">Where opens came from</p>
          <ul className="mt-2 space-y-1 text-sm">
            {data.bySource.slice(0, 5).map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{row.label}</span>
                <span className="tabular shrink-0">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border p-4 text-xs text-muted-foreground">
        <Link to="/unfinished" className="text-primary underline">
          {data.unfinishedWithMobile} unfinished with a mobile number
        </Link>
        {data.testConversations > 0 && <span>{data.testConversations} test chats excluded</span>}
      </div>
    </section>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 tabular font-medium">{value}</dd>
    </div>
  );
}
