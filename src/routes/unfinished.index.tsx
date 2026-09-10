import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { getUnfinishedProspects } from "@/lib/quote-funnel.functions";

export const Route = createFileRoute("/unfinished/")({
  head: () => {
    const title = "Unfinished enquiries — BookedSecure";
    const description =
      "People who started a quote and gave their mobile number without finishing. View only — nothing is texted to them.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: UnfinishedPage,
});

function UnfinishedPage() {
  const fetchProspects = useServerFn(getUnfinishedProspects);
  const { data, isLoading, error } = useQuery({
    queryKey: ["unfinished-prospects", 90],
    queryFn: () => fetchProspects({ data: { days: 90 } }),
  });

  return (
    <AppShell>
      <div className="min-w-0 space-y-4">
        <header className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Unfinished enquiries</h1>
          <p className="text-sm text-muted-foreground">
            They gave a mobile number but didn't finish. Kept separate from your lead inbox, and
            nothing is ever texted to them — calling is your call.
          </p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && data.prospects.length === 0 && (
          <p className="panel p-8 text-center text-sm text-muted-foreground">
            Nothing unfinished right now.
          </p>
        )}

        {data && data.prospects.length > 0 && (
          <ul className="space-y-3">
            {data.prospects.map((prospect) => (
              <li key={prospect.conversationId} className="panel min-w-0 space-y-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium break-words">{prospect.name ?? "No name given"}</p>
                  <span className="text-xs text-muted-foreground">
                    {prospect.abandoned ? "Went quiet" : "In progress"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <Datum label="Mobile" value={prospect.mobile} />
                  <Datum label="Suburb" value={prospect.suburb ?? "—"} />
                  <Datum
                    label="Looking at"
                    value={prospect.services.length > 0 ? prospect.services.join(", ") : "—"}
                  />
                  <Datum label="Got as far as" value={prospect.stageLabel} />
                </dl>
                <p className="text-xs text-muted-foreground">
                  Last activity {new Date(prospect.lastActivityAt).toLocaleString("en-AU")}
                </p>
                <a
                  href={`tel:${prospect.mobile.replace(/\s/g, "")}`}
                  className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-medium"
                >
                  Call {prospect.name?.split(" ")[0] ?? "them"}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  );
}
