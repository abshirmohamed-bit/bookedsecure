import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ReachabilityBadge } from "@/components/StatusBadge";
import {
  AUTOMATION_PAUSED_LABEL,
  RESUME_ACTION_LABEL,
  assessSuppressionRecovery,
  resumeConfirmationPoints,
  type SuppressionRecoveryLead,
} from "@/lib/sms/suppression-recovery";
import { resumeSuppressedSmsAutomation } from "@/lib/sms/suppression-recovery.functions";

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("en-AU") : "";
}

/**
 * Shows reachability and automation eligibility as two separate facts, and
 * offers the owner-only resume action. Frontend visibility is presentation
 * only — the server re-checks the owner role.
 */
export function SuppressionRecoveryPanel({
  lead,
  role,
  onResumed,
}: {
  lead: SuppressionRecoveryLead & { id: string; reachability_state?: string | null };
  role: string;
  onResumed: () => void;
}) {
  const view = assessSuppressionRecovery(lead);
  const [confirming, setConfirming] = useState(false);
  const resume = useServerFn(resumeSuppressedSmsAutomation);

  const mutation = useMutation({
    mutationFn: () => resume({ data: { leadId: lead.id, confirm: true as const } }),
    onSuccess: (result) => {
      setConfirming(false);
      if (result.status === "resumed") toast.success(result.message);
      else toast.info(result.message);
      onResumed();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!view.suppressed) return null;

  return (
    <section className="panel space-y-3 border-warning/40 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="space-y-2 text-xs">
          <h2 className="text-sm font-semibold text-foreground">Automated SMS is paused</h2>
          <p className="text-muted-foreground">
            <span className="text-muted-foreground/70">Reachability: </span>
            <ReachabilityBadge
              state={lead.reachability_state}
              evidence={lead.reachability_evidence}
              evidenceAt={lead.reachability_evidence_at}
            />
          </p>
          <p className="text-warning">
            <span className="text-muted-foreground/70">Automation: </span>
            {AUTOMATION_PAUSED_LABEL}
            {view.pausedAt ? ` on ${when(view.pausedAt)}` : ""}
            {view.pausedReason ? ` — ${view.pausedReason}` : ""}
          </p>
          <p className="text-muted-foreground">
            <span className="text-muted-foreground/70">Evidence: </span>
            {view.evidence
              ? `${view.evidence}${view.evidenceAt ? ` (${when(view.evidenceAt)})` : ""}`
              : "No delivery receipt or reply recorded since the pause."}
          </p>
          {view.reachableRecently && (
            <p className="text-muted-foreground">
              This lead is reachable recently and still paused. A delivery or reply never resumes
              automation on its own — you decide.
            </p>
          )}
        </div>
      </div>

      {role === "owner" && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          className="rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
        >
          {RESUME_ACTION_LABEL}
        </button>
      )}

      {role === "owner" && confirming && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3 text-xs">
          <p className="font-medium text-foreground">{RESUME_ACTION_LABEL}?</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {resumeConfirmationPoints({
              ...view,
              pausedAt: view.pausedAt ? when(view.pausedAt) : null,
              evidenceAt: view.evidenceAt ? when(view.evidenceAt) : null,
            }).map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {mutation.isPending ? "Resuming…" : "Confirm and resume"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {role !== "owner" && (
        <p className="text-xs text-muted-foreground">
          Only the business owner can review and resume automation for this lead.
        </p>
      )}
    </section>
  );
}
