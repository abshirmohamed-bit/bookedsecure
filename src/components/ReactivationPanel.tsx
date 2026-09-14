import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, RefreshCcw } from "lucide-react";
import {
  approveReactivation,
  cancelReactivation,
  draftReactivation,
  editReactivationDraft,
  getReactivationCampaign,
} from "@/lib/reactivation.functions";

type CampaignView = Awaited<ReturnType<typeof getReactivationCampaign>>;

/**
 * The dormant-contact overview query, shared by key so the Leads page can start
 * it in parallel with its own data instead of waiting for the page to render.
 */
export function useReactivationOverview() {
  const load = useServerFn(getReactivationCampaign);
  return useQuery({
    queryKey: ["reactivation"],
    queryFn: () => load() as Promise<CampaignView>,
    // The dormant-contact scan is the most expensive read on this page and its
    // result barely changes minute to minute, so it is cached rather than
    // re-run on every visit to the Leads page.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Owner review of the drafted reactivation campaign. Nothing here sends until
 * the owner confirms permission and approves.
 */
export function ReactivationPanel() {
  const draft = useServerFn(draftReactivation);
  const edit = useServerFn(editReactivationDraft);
  const approve = useServerFn(approveReactivation);
  const cancel = useServerFn(cancelReactivation);
  const queryClient = useQueryClient();

  const [offer, setOffer] = useState("");
  const [attested, setAttested] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  /** Drafts stay tucked away until the owner chooses to review them. */
  const [reviewOpen, setReviewOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const campaign = useReactivationOverview();

  useEffect(() => {
    const text = campaign.data?.campaign?.offerText;
    if (text && offer.length === 0) setOffer(text);
  }, [campaign.data?.campaign?.offerText, offer.length]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["reactivation"] });

  const drafting = useMutation({
    mutationFn: () => draft({ data: { offerText: offer.trim() || null } }),
    onSuccess: (result) => {
      toast.success(`Draft ready for ${result.drafts.length} dormant leads. Nothing sent yet.`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saving = useMutation({
    mutationFn: (input: { draftId: string; body?: string; status?: "draft" | "skipped" }) =>
      edit({ data: input }),
    onSuccess: () => {
      toast.success("Message updated");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approving = useMutation({
    mutationFn: (draftIds?: string[]) =>
      approve({
        data: {
          campaignId: campaign.data?.campaign?.id ?? "",
          attested,
          draftIds: draftIds ?? null,
        },
      }),
    onSuccess: (result) => {
      toast.success(`${result.sent} sent, ${result.failed} not sent`);
      setAttested(false);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelling = useMutation({
    mutationFn: () => cancel({ data: { campaignId: campaign.data?.campaign?.id ?? "" } }),
    onSuccess: () => {
      toast.success("Campaign discarded");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = campaign.data;
  const pending = (data?.drafts ?? []).filter((row) => row.status === "draft");
  // Bringing past customers back is included in the higher plan only.
  const locked = data ? data.reactivationEnabled === false : false;

  if (locked) {
    return (
      <section id="reactivation" className="panel overflow-hidden px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Win back dormant leads</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You have {data?.candidates ?? 0} past contacts who could be invited back. Bringing
              them back is part of the Pro plan — your {data?.planName} plan doesn&apos;t include
              it yet.
            </p>
            <a href="/pricing" className="mt-2 inline-block text-xs font-medium underline">
              See what Pro adds
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="reactivation" className="panel overflow-hidden scroll-mt-4">

      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-success/15 text-success-foreground">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Win back dormant leads</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data
                ? `${data.candidates} contacts with no conversation, booking or enquiry details on record.`
                : "Checking your list…"}
            </p>
            {!data?.campaign && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave the offer blank and we&apos;ll suggest one from your services. You review
                every message before anything is sent.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={offer}
            onChange={(event) => setOffer(event.target.value)}
            placeholder="Offer, e.g. 15% off your next detail"
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs sm:w-64"
          />
          <button
            onClick={() => drafting.mutate()}
            disabled={drafting.isPending}
            className="h-8 rounded-md border border-primary/50 bg-card px-3 text-xs font-medium text-primary hover:bg-secondary disabled:opacity-60"
          >
            {data?.campaign ? "Redraft" : "Draft campaign"}
          </button>
        </div>
      </div>

      {data?.campaign && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setReviewOpen((open) => !open)}
            aria-expanded={reviewOpen}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs hover:bg-secondary/40"
          >
            <span className="min-w-0 truncate text-muted-foreground">
              Offer: <span className="font-medium text-foreground">{data.campaign.offerText}</span> ·{" "}
              {pending.length} awaiting approval
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium">
              {reviewOpen ? "Hide drafts" : "Review drafts"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${reviewOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </span>
          </button>

          {reviewOpen && (
            <ul className="max-h-[34vh] divide-y divide-border overflow-y-auto border-t border-border lg:max-h-[40vh]">
              {data.drafts.map((row) => (
                <DraftRow
                  key={row.id}
                  row={row}
                  expanded={expanded === row.id}
                  onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
                  editing={editing[row.id]}
                  onEditChange={(value) =>
                    setEditing((current) => ({ ...current, [row.id]: value }))
                  }
                  onStartEdit={() => setEditing((current) => ({ ...current, [row.id]: row.body }))}
                  onCancelEdit={() =>
                    setEditing((current) => {
                      const next = { ...current };
                      delete next[row.id];
                      return next;
                    })
                  }
                  onSave={() => {
                    saving.mutate({ draftId: row.id, body: editing[row.id] ?? row.body });
                    setEditing((current) => {
                      const next = { ...current };
                      delete next[row.id];
                      return next;
                    });
                  }}
                  onSkip={() => saving.mutate({ draftId: row.id, status: "skipped" })}
                  onSend={() => approving.mutate([row.id])}
                  canSend={attested && !approving.isPending}
                />
              ))}
            </ul>
          )}

          <div className="sticky bottom-0 space-y-2 border-t border-border bg-card px-4 py-3">
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
                className="mt-0.5"
              />
              I have permission to text these customers about my services.
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => approving.mutate(undefined)}
                disabled={!attested || pending.length === 0 || approving.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Approve and send all ({pending.length})
              </button>
              <button
                onClick={() => cancelling.mutate()}
                disabled={cancelling.isPending}
                className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground"
              >
                Discard campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type DraftRowData = CampaignView["drafts"][number];

/** One compact draft: a single line collapsed, full message and actions when expanded. */
function DraftRow({
  row,
  expanded,
  onToggle,
  editing,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  onSkip,
  onSend,
  canSend,
}: {
  row: DraftRowData;
  expanded: boolean;
  onToggle: () => void;
  editing: string | undefined;
  onEditChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onSkip: () => void;
  onSend: () => void;
  canSend: boolean;
}) {
  const isDraft = row.status === "draft";
  return (
    <li className={isDraft ? "" : "opacity-60"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 text-left hover:bg-secondary/40"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">
            {row.leadName ?? "Unnamed"} · {row.mobileNumber}
          </span>
          {!expanded && (
            <span className="block truncate text-[11px] text-muted-foreground">{row.body}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.status}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {row.sendReason && (
            <p className="mb-1 text-[11px] text-muted-foreground">{row.sendReason}</p>
          )}
          {editing === undefined ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{row.body}</p>
          ) : (
            <textarea
              value={editing}
              onChange={(event) => onEditChange(event.target.value)}
              rows={4}
              maxLength={320}
              className="w-full rounded-md border border-input bg-background p-2 text-xs"
            />
          )}
          {isDraft && (
            <div className="mt-2 flex flex-wrap gap-2">
              {editing === undefined ? (
                <button
                  onClick={onStartEdit}
                  className="rounded-md border border-input px-2 py-1 text-[11px]"
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    onClick={onSave}
                    className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
                  >
                    Save
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="rounded-md border border-input px-2 py-1 text-[11px]"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={onSkip}
                className="rounded-md border border-input px-2 py-1 text-[11px] text-muted-foreground"
              >
                Skip
              </button>
              <button
                onClick={onSend}
                disabled={!canSend}
                className="rounded-md border border-input px-2 py-1 text-[11px] disabled:opacity-50"
              >
                Send this one
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
