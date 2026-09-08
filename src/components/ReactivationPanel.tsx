import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCcw } from "lucide-react";
import {
  approveReactivation,
  cancelReactivation,
  draftReactivation,
  editReactivationDraft,
  getReactivationCampaign,
} from "@/lib/reactivation.functions";

type CampaignView = Awaited<ReturnType<typeof getReactivationCampaign>>;

/**
 * Owner review of the drafted reactivation campaign. Nothing here sends until
 * the owner confirms permission and approves.
 */
export function ReactivationPanel() {
  const load = useServerFn(getReactivationCampaign);
  const draft = useServerFn(draftReactivation);
  const edit = useServerFn(editReactivationDraft);
  const approve = useServerFn(approveReactivation);
  const cancel = useServerFn(cancelReactivation);
  const queryClient = useQueryClient();

  const [offer, setOffer] = useState("");
  const [attested, setAttested] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const campaign = useQuery({
    queryKey: ["reactivation"],
    queryFn: () => load() as Promise<CampaignView>,
  });

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

  return (
    <section className="panel overflow-hidden">
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
        <div className="space-y-3 border-t border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Offer: <span className="font-medium text-foreground">{data.campaign.offerText}</span> ·{" "}
            {pending.length} awaiting approval
          </p>

          <ul className="space-y-2">
            {data.drafts.map((row) => (
              <li key={row.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    {row.leadName ?? "Unnamed"} · {row.mobileNumber}
                  </p>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {row.status}
                    {row.sendReason ? ` · ${row.sendReason}` : ""}
                  </span>
                </div>
                {editing[row.id] === undefined ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">{row.body}</p>
                ) : (
                  <textarea
                    value={editing[row.id]}
                    onChange={(event) =>
                      setEditing((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    rows={3}
                    maxLength={320}
                    className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-xs"
                  />
                )}
                {row.status === "draft" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {editing[row.id] === undefined ? (
                      <button
                        onClick={() =>
                          setEditing((current) => ({ ...current, [row.id]: row.body }))
                        }
                        className="rounded-md border border-input px-2 py-1 text-[11px]"
                      >
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            saving.mutate({ draftId: row.id, body: editing[row.id] ?? row.body });
                            setEditing((current) => {
                              const next = { ...current };
                              delete next[row.id];
                              return next;
                            });
                          }}
                          className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
                        >
                          Save
                        </button>
                        <button
                          onClick={() =>
                            setEditing((current) => {
                              const next = { ...current };
                              delete next[row.id];
                              return next;
                            })
                          }
                          className="rounded-md border border-input px-2 py-1 text-[11px]"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => saving.mutate({ draftId: row.id, status: "skipped" })}
                      className="rounded-md border border-input px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => approving.mutate([row.id])}
                      disabled={!attested || approving.isPending}
                      className="rounded-md border border-input px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      Send this one
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

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
      )}
    </section>
  );
}
