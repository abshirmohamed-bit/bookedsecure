import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  runOwnerRequest,
  confirmOwnerStatusChange,
  confirmAddonLinks,
  confirmLeadUpdate,
} from "@/lib/owner-actions.functions";
import { approveReactivation } from "@/lib/reactivation.functions";
import { normaliseOwnerQuestion, OWNER_ASSISTANT_MAX_QUESTION } from "@/lib/owner-assistant";
import { previewCrmImport } from "@/lib/csv-import.functions";
import { MAX_CSV_BYTES } from "@/lib/csv-import";
import { completeAssistantMessage } from "@/lib/assistant-history.functions";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";

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

type AddonLinkProposal = {
  kind: "addon_links";
  addonId: string;
  addonName: string;
  serviceIds: string[];
  serviceNames: string[];
  remove: boolean;
  summary: string;
};

type LeadUpdateProposal = {
  kind: "lead_update";
  leadId: string;
  leadName: string;
  lines: string[];
  summary: string;
  details: Record<string, string>;
  markCompleted: boolean;
  paidAmount: number | null;
  bookAt: string | null;
};

type Proposal = CampaignProposal | StatusProposal | AddonLinkProposal | LeadUpdateProposal;

type Turn = {
  id: string;
  role: "you" | "assistant";
  text: string;
  proposals?: Proposal[];
  done?: string;
};

export type OwnerAssistantTurn = Turn;

function newId(): string {
  return Math.random().toString(36).slice(2);
}

const TEXTAREA_MAX_HEIGHT = 120;

/** Grows the input up to a few lines, then lets it scroll internally. */
function autoSize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
}

/**
 * The tenant's AI-led assistant: ask about your own business, or ask for a
 * win-back campaign or a bulk status change. Answers appear in the conversation
 * above the box, and every action is proposed first and only runs once you
 * approve it. Rendered inside the signed-in workspace shell.
 */
export function OwnerAssistant({
  threadId,
  initialTurns = [],
  onConversationChanged,
}: {
  threadId: string;
  initialTurns?: OwnerAssistantTurn[];
  onConversationChanged?: () => void;
}) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const ask = useServerFn(runOwnerRequest);
  const applyStatus = useServerFn(confirmOwnerStatusChange);
  const linkAddons = useServerFn(confirmAddonLinks);
  const updateLead = useServerFn(confirmLeadUpdate);
  const approve = useServerFn(approveReactivation);
  const upload = useServerFn(previewCrmImport);
  const completeMessage = useServerFn(completeAssistantMessage);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) autoSize(textareaRef.current);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [attested, setAttested] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setTurns(initialTurns);
  }, [initialTurns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const mutation = useMutation({
    mutationFn: (value: string) => ask({ data: { question: value, threadId } }),
    onSuccess: (result) =>
      setTurns((current) => [
        ...current,
        {
          id: result.assistantMessageId ?? newId(),
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
    void completeMessage({ data: { messageId: turnId, done: message } }).catch(() => {
      toast.error("The action completed, but its conversation note could not be saved.");
    });
    // Keep the completed proposal visible locally. The next server refresh will
    // hydrate the same completion note from the account-backed conversation.
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

  const leadMutation = useMutation({
    mutationFn: (input: { turnId: string; proposal: LeadUpdateProposal }) =>
      updateLead({
        data: {
          leadId: input.proposal.leadId,
          details: input.proposal.details as never,
          markCompleted: input.proposal.markCompleted,
          paidAmount: input.proposal.paidAmount,
          bookAt: input.proposal.bookAt,
        },
      }),
    onSuccess: (_result, input) =>
      markDone(input.turnId, `${input.proposal.leadName} is up to date.`),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That update could not be saved."),
    onSettled: () => setBusyId(null),
  });

  const addonMutation = useMutation({
    mutationFn: (input: { turnId: string; proposal: AddonLinkProposal }) =>
      linkAddons({
        data: {
          addonId: input.proposal.addonId,
          serviceIds: input.proposal.serviceIds,
          remove: input.proposal.remove,
        },
      }),
    onSuccess: (result, input) =>
      markDone(
        input.turnId,
        input.proposal.remove
          ? `Removed "${input.proposal.addonName}" from ${result.changed} service${result.changed === 1 ? "" : "s"}.`
          : `"${input.proposal.addonName}" is now offered with ${result.changed} service${result.changed === 1 ? "" : "s"}.`,
      ),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That change could not be applied."),
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
    mutation.mutate(text, { onSettled: () => {
      onConversationChanged?.();
      requestAnimationFrame(() => textareaRef.current?.focus());
    } });
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
    <section className="flex h-full min-h-0 w-full flex-col">
      <div className="flex w-full flex-1 flex-col justify-center">
        {!hasConversation ? (
          <div className="mx-auto mb-6 mt-auto max-w-2xl text-center sm:mb-8">
            <h1 className="text-balance font-heading text-2xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
              Stop losing leads you already paid for.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:mt-4">
              Catch every ad enquiry, reply instantly, and rebook past customers — all from one
              place.
            </p>
          </div>
        ) : null}

        {hasConversation ? (
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-4 pb-8 pt-28 sm:px-8">
            {turns.map((turn) => (
              <Message key={turn.id} from={turn.role === "you" ? "user" : "assistant"}>
                {turn.role === "you" ? (
                  <MessageContent className="bg-primary text-primary-foreground"><MessageResponse>{turn.text}</MessageResponse></MessageContent>
                ) : (
                  <div className="max-w-[95%] space-y-3">
                    <MessageContent><MessageResponse>{turn.text}</MessageResponse></MessageContent>

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
                      ) : proposal.kind === "lead_update" ? (
                        <div
                          key={`${proposal.leadId}-update`}
                          className="rounded-2xl border border-border bg-card p-4 text-sm"
                        >
                          <p className="font-medium">Update {proposal.leadName}</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                            {proposal.lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            disabled={busyId === turn.id}
                            onClick={() => {
                              setBusyId(turn.id);
                              leadMutation.mutate({ turnId: turn.id, proposal });
                            }}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {busyId === turn.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Confirm
                          </button>
                        </div>
                      ) : proposal.kind === "addon_links" ? (
                        <div
                          key={`${proposal.addonId}-${proposal.remove ? "off" : "on"}`}
                          className="rounded-2xl border border-border bg-card p-4 text-sm"
                        >
                          <p className="font-medium">
                            {proposal.remove ? "Remove add-on" : "Add-on availability"} —{" "}
                            {proposal.addonName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{proposal.summary}</p>
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {proposal.serviceNames.map((name) => (
                              <li
                                key={name}
                                className="rounded-full bg-secondary/60 px-2.5 py-1 text-xs"
                              >
                                {name}
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            disabled={busyId === turn.id}
                            onClick={() => {
                              setBusyId(turn.id);
                              addonMutation.mutate({ turnId: turn.id, proposal });
                            }}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {busyId === turn.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Confirm
                          </button>
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
              </Message>
            ))}
            {mutation.isPending ? (
              <p className="text-xs text-muted-foreground">Working on it…</p>
            ) : null}
            <div ref={endRef} />
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        ) : null}

        <PromptInput
          onSubmit={(message) => submit(message.text ?? question)}
          className="mx-auto mb-5 w-[calc(100%-2rem)] max-w-3xl rounded-2xl border-border bg-card shadow-xl"
        >
          <label className="sr-only" htmlFor="owner-question">
            Ask about your business or ask for a campaign
          </label>
          <PromptInputTextarea
            id="owner-question"
            ref={textareaRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={OWNER_ASSISTANT_MAX_QUESTION}
            placeholder="Message Assistant…"
          />
          <PromptInputFooter>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={chooseFile}
              disabled={importMutation.isPending}
              title="Upload old leads"
               className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60 sm:px-3"
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
            </div>
            <PromptInputSubmit
              status={mutation.isPending ? "submitted" : "ready"}
              disabled={mutation.isPending || normaliseOwnerQuestion(question).length === 0}
              aria-label={signedIn ? "Ask" : "Sign in to ask"}
            />
          </PromptInputFooter>
          {!loading ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {signedIn ? "Nothing sends without your approval" : "Sign in to ask"}
            </p>
          ) : null}
        </PromptInput>
      </div>
    </section>
  );
}
