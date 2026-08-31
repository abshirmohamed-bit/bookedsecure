import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CircleCheckBig, X } from "lucide-react";
import { toast } from "sonner";
import { MetricTile } from "@/components/import/MetricTile";
import { formatUploadTimestamp, shortBatchId } from "@/lib/import-history";
import { IMPORT_GATE_LABELS, type ImportGateReason } from "@/lib/import-automation";
import {
  canaryCheckLabel,
  canaryHeadline,
  canaryOutcomeMetrics,
  canaryTechnicalText,
  type CanaryLikeResult,
} from "@/lib/import-presentation";

/**
 * Result card for the one-row canary verification. Presentation only: it never
 * commits anything and offers no commit action.
 */
export function CanaryResultCard({
  result,
  batchId,
  ranAt,
  gateReasons,
}: {
  result: CanaryLikeResult;
  batchId: string | null;
  ranAt: string | null;
  gateReasons: readonly ImportGateReason[];
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const headline = canaryHeadline(result.status);
  const ok = result.status === "passed" || result.status === "idempotent_pass";
  const metrics = canaryOutcomeMetrics(result);
  const technical = canaryTechnicalText(result, { batchId, ranAt });

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(technical);
      toast.success("Verification details copied to the clipboard.");
    } catch {
      toast.error("Could not copy the verification details.");
    }
  };

  return (
    <div
      id="canary-result"
      className={`space-y-3 rounded-lg border p-3 ${ok ? "border-success/40 bg-success/5" : "border-destructive/50 bg-destructive/5"}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {ok ? (
          <CircleCheckBig className="h-7 w-7 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-7 w-7 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h3 className={`text-sm font-semibold ${ok ? "text-success" : "text-destructive"}`}>
            {headline.title}
          </h3>
          <p className="text-xs text-foreground">{headline.subtitle}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Row {result.row_number}
            {ranAt ? ` · ${formatUploadTimestamp(ranAt)}` : ""}
            {batchId ? ` · Batch ${shortBatchId(batchId)}` : ""}
          </p>
        </div>
      </div>

      {!ok && gateReasons.length ? (
        <p className="text-xs text-destructive">
          {gateReasons.map((reason) => IMPORT_GATE_LABELS[reason] ?? reason).join(" ")}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric) => (
          <MetricTile
            key={metric.label}
            label={metric.label}
            value={metric.value}
            tone={metric.tone}
          />
        ))}
      </dl>

      {result.checks.length ? (
        <ul className="space-y-1 text-xs">
          {result.checks.map((check) => (
            <li key={check.check} className="flex min-w-0 items-start gap-2">
              {check.passed ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
              )}
              <span className={check.passed ? "text-foreground" : "text-destructive"}>
                {canaryCheckLabel(check.check)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {result.lead_id ? (
          <Link
            to="/leads/$leadId"
            params={{ leadId: result.lead_id }}
            className="rounded-md border border-input px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open this lead in the inbox
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => void copyDetails()}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Copy verification details
        </button>
        <button
          type="button"
          aria-expanded={showTechnical}
          onClick={() => setShowTechnical((value) => !value)}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {showTechnical ? "Hide technical details" : "View technical details"}
        </button>
      </div>

      {showTechnical ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold">Technical verification details</h4>
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
            {technical}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
