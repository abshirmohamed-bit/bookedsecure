import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { getAutoCompleteJobs, setAutoCompleteJobs } from "@/lib/job-autocomplete.functions";

/** "Complete jobs automatically": booked jobs count as done after their time unless cancelled. */
export function AutoCompleteJobsCard() {
  const qc = useQueryClient();
  const load = useServerFn(getAutoCompleteJobs);
  const save = useServerFn(setAutoCompleteJobs);
  const q = useQuery({ queryKey: ["auto-complete-jobs"], queryFn: () => load() });
  const change = useMutation({
    mutationFn: (enabled: boolean) => save({ data: { enabled } }),
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? "Booked jobs will now complete automatically after their time." : "Jobs will only be completed when you mark them done.");
      void qc.invalidateQueries({ queryKey: ["auto-complete-jobs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change this setting."),
  });
  const d = q.data;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Complete jobs automatically</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When a booked job's time has passed, mark it done and add its price to Completed work, unless you cancelled it.
            The price comes from the service's own price (for example "From $280" counts as $280). You can still change any job by hand.
          </p>
          {d && !d.available && <p className="mt-2 text-xs text-muted-foreground">This setting is waiting for a BookedSecure update.</p>}
        </div>
        <Switch
          checked={Boolean(d?.enabled)}
          disabled={!d?.available || !d?.isOwner || change.isPending}
          onCheckedChange={(value) => change.mutate(value)}
          aria-label="Complete jobs automatically"
        />
      </div>
    </section>
  );
}
