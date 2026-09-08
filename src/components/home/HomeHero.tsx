import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, CalendarClock, Check, Loader2, Paperclip, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { runOwnerRequest, confirmOwnerStatusChange } from "@/lib/owner-actions.functions";
import { approveReactivation } from "@/lib/reactivation.functions";
import { normaliseOwnerQuestion, OWNER_ASSISTANT_MAX_QUESTION } from "@/lib/owner-assistant";
import { previewCrmImport } from "@/lib/csv-import.functions";
import { MAX_CSV_BYTES } from "@/lib/csv-import";

const SUGGESTIONS = [
  "What's waiting on a reply?",
  "Draft a 15% win-back campaign for 10 contacts we haven't messaged in 2 weeks",
  "Mark the leads that are new as contacted",
  "How many new leads this week?",
] as const;

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
  const [followUp, setFollowUp] = useState(false);
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
      toast.success(
        followUp
          ? "Contacts checked. Open the import page to approve the win-back follow-up."
          : "Contacts checked. Open the import page to review and save them.",
      );
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
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
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
          <textarea
            id="owner-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(question);
              }
            }}
            rows={2}
            maxLength={OWNER_ASSISTANT_MAX_QUESTION}
            placeholder="Draft a 10% win-back campaign for contacts we haven't messaged in 2 weeks"
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-3 space-y-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
            <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              <button
                type="button"
                onClick={chooseFile}
                disabled={importMutation.isPending}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60 sm:py-1.5"
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {importMutation.isPending ? "Checking contacts…" : "Upload old leads"}
              </button>
              <button
                type="button"
                aria-pressed={followUp}
                onClick={() => setFollowUp((value) => !value)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs sm:py-1.5 ${
                  followUp
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Attach follow-up
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
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {loading
                  ? "Checking your access…"
                  : signedIn
                    ? "Nothing sends without your approval"
                    : "Sign in to ask"}
              </span>
              <button
                type="submit"
                aria-label="Ask"
                disabled={mutation.isPending || normaliseOwnerQuestion(question).length === 0}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 sm:h-9 sm:w-9"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </form>

        <p className="mt-3 flex items-start justify-center gap-1.5 text-left text-xs leading-relaxed text-muted-foreground sm:items-center sm:text-center">
          <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" aria-hidden="true" />
          <span>
            {followUp
              ? "Uploaded contacts will be checked, then you'll approve a win-back follow-up before anything sends."
              : "Upload a contact list from your old system — nothing is messaged without your approval."}
          </span>
        </p>

        {!hasConversation ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submit(suggestion)}
                className="rounded-2xl border border-border px-3.5 py-2.5 text-left text-xs leading-snug text-muted-foreground hover:bg-secondary hover:text-foreground sm:rounded-full sm:py-1.5 sm:text-center"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
