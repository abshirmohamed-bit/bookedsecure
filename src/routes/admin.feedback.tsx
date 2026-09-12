import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { listFeedbackSubmissions, updateFeedbackSubmission } from "@/lib/feedback.functions";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackStatus,
} from "@/lib/feedback";

export const Route = createFileRoute("/admin/feedback")({
  head: () => ({
    meta: [
      { title: "Tenant feedback — BookedSecure admin" },
      {
        name: "description",
        content:
          "Platform review queue for tenant feature requests and issue reports, with the sending business and page recorded.",
      },
      { property: "og:title", content: "Tenant feedback — BookedSecure admin" },
      {
        property: "og:description",
        content: "Review feature requests and issue reports sent by BookedSecure tenants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FeedbackQueuePage,
  errorComponent: ({ error }) => (
    <AppShell title="Tenant feedback">
      <div className="panel p-4">
        <h1 className="page-heading">Tenant feedback</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell title="Tenant feedback">
      <p className="text-sm text-muted-foreground">Page not found.</p>
    </AppShell>
  ),
});

function FeedbackQueuePage() {
  return (
    <AppShell title="Tenant feedback">
      <FeedbackQueue />
    </AppShell>
  );
}

function FeedbackQueue() {
  const fetchList = useServerFn(listFeedbackSubmissions);
  const save = useServerFn(updateFeedbackSubmission);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | FeedbackStatus>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-feedback", status],
    queryFn: () => fetchList({ data: { status } }),
    retry: false,
  });

  const update = useMutation({
    mutationFn: (input: { id: string; status: FeedbackStatus }) => save({ data: input }),
    onSuccess: async () => {
      toast.success("Feedback updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
    },
    onError: (mutationError: unknown) =>
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not update."),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading feedback…</p>;
  if (error)
    return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const submissions = data?.submissions ?? [];

  return (
    <section className="grid gap-4">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <h1 className="page-heading mr-auto">Tenant feedback</h1>
        <label htmlFor="feedback-status" className="text-xs text-muted-foreground">
          Status
        </label>
        <select
          id="feedback-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as "all" | FeedbackStatus)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All</option>
          {FEEDBACK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {FEEDBACK_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <ul className="grid gap-3">
          {submissions.map((item) => (
            <li key={item.id} className="panel grid gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-foreground">
                  {FEEDBACK_KIND_LABELS[item.kind]}
                </span>
                <span>{FEEDBACK_STATUS_LABELS[item.status]}</span>
                <span>{new Date(item.createdAt).toLocaleString("en-AU")}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
              <div className="grid gap-0.5 text-xs text-muted-foreground">
                <span>
                  {item.businessName ?? "Unknown business"} · tenant {item.businessId}
                </span>
                <span>
                  {item.senderName ?? "Unknown person"}
                  {item.senderEmail ? ` · ${item.senderEmail}` : ""}
                  {item.userId ? ` · user ${item.userId}` : ""}
                </span>
                {item.pagePath ? <span>Sent from {item.pagePath}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_STATUSES.filter((value) => value !== item.status).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: item.id, status: value })}
                  >
                    Mark {FEEDBACK_STATUS_LABELS[value].toLowerCase()}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
