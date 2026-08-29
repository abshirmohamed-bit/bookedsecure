import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { telnyxReadinessCheck } from "@/lib/telnyx-readiness.functions";

const STATUS_STYLES: Record<string, string> = {
  pass: "border-emerald-500/40 text-emerald-400",
  fail: "border-destructive/50 text-destructive",
  unknown: "border-border text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  pass: "Ready",
  fail: "Blocked",
  unknown: "Unknown",
};

/**
 * Platform-admin only. Read-only activation checklist for the approved Telnyx
 * Australian number. Running it never sends a message and never activates or
 * assigns the number.
 */
export function TelnyxReadinessPanel() {
  const runCheck = useServerFn(telnyxReadinessCheck);
  const check = useMutation({
    mutationFn: () => runCheck(),
    onError: (error: Error) => toast.error(error.message),
  });

  const report = check.data ?? null;

  return (
    <div className="mt-6 rounded-md border border-dashed border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Telnyx activation readiness (platform admin)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only audit of the approved Australian number. No messages are sent, and the number
            stays inactive and unassigned until activation is explicitly approved.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
          onClick={() => check.mutate()}
          disabled={check.isPending}
        >
          {check.isPending ? "Checking…" : "Run readiness check"}
        </button>
      </div>

      {report && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono">{report.phoneNumber}</span>
            <span
              className={`rounded-full border px-2 py-0.5 ${
                report.overall === "ready" ? STATUS_STYLES["pass"] : STATUS_STYLES["fail"]
              }`}
            >
              {report.overall === "ready" ? "All checks pass" : "Not ready to activate"}
            </span>
            <span className="text-muted-foreground">
              sender row: {report.senderRow.exists ? "present" : "missing"} ·{" "}
              {report.senderRow.active ? "active" : "inactive"} ·{" "}
              {report.senderRow.assignedBusinessId ? "assigned" : "unassigned"}
            </span>
          </div>

          <ul className="space-y-2">
            {report.checks.map((item) => (
              <li key={item.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{item.label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
