import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Check, Loader2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { runOwnerRequest, confirmOwnerStatusChange } from "@/lib/owner-actions.functions";
import { approveReactivation } from "@/lib/reactivation.functions";
import { normaliseOwnerQuestion, OWNER_ASSISTANT_MAX_QUESTION } from "@/lib/owner-assistant";
import { previewCrmImport } from "@/lib/csv-import.functions";
import { MAX_CSV_BYTES } from "@/lib/csv-import";

type CampaignProposal = {
  kind: "campaign";
  campaignId: string;
  offerText: string;
  summary: string;
  drafts: Array<{ id: string; leadName: string | null; mobileNumber: string; body: string }>;
};

type StatusProposal = {
  kind: "status";
  from: string | null;
  to: string;
  count: number;
  maxLeads: number | null;
  summary: string;
};

type Proposal = CampaignProposal | StatusProposal;

type Turn = {
  id: string;
  role: "you" | "assistant";
  text: string;
  proposals?: Proposal[];
  done?: string;
};

function newId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Signed-in home: ask about your own business, or ask for a win-back campaign or
 * a bulk status change. Answers appear in the conversation above the box, and
 * every action is proposed first and only runs once you approve it.
 */
export function HomeHero() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const ask = useServerFn(runOwnerRequest);
  const applyStatus = useServerFn(confirmOwnerStatusChange);
  const approve = useServerFn(approveReactivation);
  const upload = useServerFn(previewCrmImport);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [attested, setAttested] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const mutation = useMutation({
    mutationFn: (value: string) => ask({ data: { question: value } }),
    onSuccess: (result) =>
      setTurns((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: result.answer,
          proposals: (result.proposals ?? []) as Proposal[],
        },
      ]),
    onError: (error) =>
      setTurns((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: error instanceof Error ? error.message : "That request could not be completed.",
        },
      ]),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      return upload({ data: { filename: file.name, content } });
    },
    onSuccess: () => {
      toast.success("Contacts checked. Open the import page to review and save them.");
      navigate({ to: "/import" });
    },
    onError: () => toast.error("We could not read that contact file. Nothing was saved."),
  });

  const signedIn = Boolean(session);

  function markDone(turnId: string, message: string) {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId ? { ...turn, proposals: [], done: message } : turn,
      ),
    );
  }

  const approveMutation = useMutation({
    mutationFn: (input: { turnId: string; campaignId: string }) =>
      approve({ data: { campaignId: input.campaignId, attested: true, draftIds: null } }),
    onSuccess: (result, input) => {
      markDone(
        input.turnId,
        `Sent ${result.sent} message${result.sent === 1 ? "" : "s"}${result.failed ? `, ${result.failed} could not be sent` : ""}.`,
      );
      setAttested(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The campaign could not be sent."),
    onSettled: () => setBusyId(null),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { turnId: string; proposal: StatusProposal }) =>
      applyStatus({
        data: {
          from: input.proposal.from as never,
          to: input.proposal.to as never,
          maxLeads: input.proposal.maxLeads,
        },
      }),
    onSuccess: (result, input) =>
      markDone(input.turnId, `Updated ${result.updated} lead${result.updated === 1 ? "" : "s"}.`),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Those leads could not be updated."),
    onSettled: () => setBusyId(null),
  });

  function submit(value: string) {
    const text = normaliseOwnerQuestion(value);
    if (!text) return;
    if (!signedIn) {
      navigate({ to: "/auth" });
      return;
    }
    setTurns((current) => [...current, { id: newId(), role: "you", text }]);
    setQuestion("");
    mutation.mutate(text);
  }

  function chooseFile() {
    if (!signedIn) {
      navigate({ to: "/auth" });
      return;
    }
    fileRef.current?.click();
  }

  const hasConversation = turns.length > 0;

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <span className="text-sm font-semibold tracking-tight">BookedSecure</span>
        <nav className="flex items-center gap-2 text-sm">
          {signedIn ? (
            <Link
              to="/dashboard"
              className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Go to leads
            </Link>
          ) : (
            <>
              <Link
                to="/landing"
                className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground"
              >
                How it works
              </Link>
              <Link
                to="/auth"
                className="rounded-md bg-primary px-3.5 py-2 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Sign in
              </Link>
            </>
          )}
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 pb-10 pt-2 sm:px-6 sm:pb-16">
        {!hasConversation ? (
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              Stop losing leads you already paid for.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:mt-4">
              Catch every ad enquiry, reply instantly, and rebook past customers — all from one
              place.
            </p>
          </div>
        ) : null}

        {hasConversation ? (
          <div className="mb-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {turns.map((turn) => (
              <div key={turn.id} className={turn.role === "you" ? "flex justify-end" : ""}>
                {turn.role === "you" ? (
                  <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {turn.text}
                  </p>
                ) : (
                  <div className="max-w-[95%] space-y-3">
                    <p className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-sm leading-relaxed">
                      {turn.text}
                    </p>

                    {turn.proposals?.map((proposal) =>
                      proposal.kind === "campaign" ? (
                        <div
                          key={proposal.campaignId}
                          className="rounded-2xl border border-border bg-card p-4 text-sm"
                        >
                          <p className="font-medium">Win-back campaign — {proposal.offerText}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {proposal.drafts.length} message
                            {proposal.drafts.length === 1 ? "" : "s"} ready. Review below, then
                            approve to send.
                          </p>
                          <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                            {proposal.drafts.map((draft) => (
                              <li key={draft.id} className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs font-medium">
                                  {draft.leadName ?? "Contact"} · {draft.mobileNumber}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">{draft.body}</p>
                              </li>
                            ))}
                          </ul>
                          {proposal.drafts.length > 0 ? (
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={attested}
                                  onChange={(event) => setAttested(event.target.checked)}
                                  className="h-3.5 w-3.5"
                                />
                                I have permission to contact these customers
                              </label>
                              <button
                                type="button"
                                disabled={!attested || busyId === proposal.campaignId}
                                onClick={() => {
                                  setBusyId(proposal.campaignId);
                                  approveMutation.mutate({
                                    turnId: turn.id,
                                    campaignId: proposal.campaignId,
                                  });
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                              >
                                {busyId === proposal.campaignId ? (
                                  <Loader2
                                    className="h-3.5 w-3.5 animate-spin"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                Approve and send
                              </button>
                              <Link
                                to="/import"
                                className="text-xs text-muted-foreground underline hover:text-foreground"
                              >
                                Edit on the campaign page
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          key={`${proposal.from ?? "any"}-${proposal.to}`}
                          className="rounded-2xl border border-border bg-card p-4 text-sm"
                        >
                          <p className="font-medium">Lead status change</p>
                          <p className="mt-1 text-xs text-muted-foreground">{proposal.summary}</p>
                          <button
                            type="button"
                            disabled={busyId === turn.id}
                            onClick={() => {
                              setBusyId(turn.id);
                              statusMutation.mutate({ turnId: turn.id, proposal });
                            }}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {busyId === turn.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Confirm change
                          </button>
                        </div>
                      ),
                    )}

                    {turn.done ? (
                      <p className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
                        {turn.done}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            {mutation.isPending ? (
              <p className="text-xs text-muted-foreground">Working on it…</p>
            ) : null}
            <div ref={endRef} />
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(question);
          }}
          className="rounded-2xl border border-border bg-card p-4 text-left shadow-lg"
        >
          <label className="sr-only" htmlFor="owner-question">
            Ask about your business or ask for a campaign
          </label>
          <div className="flex items-start gap-2 sm:gap-3">
            <button
              type="button"
              onClick={chooseFile}
              disabled={importMutation.isPending}
              title="Upload old leads"
              className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60 sm:px-3"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Upload</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              aria-label="Choose a contact file to upload"
              accept=".csv,text/csv,.tsv,text/tab-separated-values"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > MAX_CSV_BYTES) {
                  toast.error("That file is larger than 2 MB.");
                  return;
                }
                importMutation.mutate(file);
              }}
            />
            <textarea
              id="owner-question"
              ref={textareaRef}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                autoSize(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(question);
                }
              }}
              rows={1}
              maxLength={OWNER_ASSISTANT_MAX_QUESTION}
              placeholder="Draft a 10% win-back campaign for contacts we haven't messaged in 2 weeks"
              className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              aria-label={signedIn ? "Ask" : "Sign in to ask"}
              title={signedIn ? "Ask" : "Sign in to ask"}
              disabled={mutation.isPending || normaliseOwnerQuestion(question).length === 0}
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {!loading ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {signedIn ? "Nothing sends without your approval" : "Sign in to ask"}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
