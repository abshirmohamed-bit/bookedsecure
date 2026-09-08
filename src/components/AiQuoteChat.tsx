import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { TenantMark } from "@/components/TenantMark";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import {
  replyQuoteConversation,
  resumeQuoteConversation,
  startQuoteConversation,
} from "@/lib/web-chat.functions";
import { asksForServiceList, isSuppressedOpeningTurn } from "@/lib/web-chat-presentation";
import { FLEXIBLE_CHOICE, type WebChatPrompt } from "@/lib/web-chat";
import { BOOKING_CHANGE_CHOICE, BOOKING_CONFIRM_CHOICE, NO_SLOT_CHOICE } from "@/lib/web-chat-booking";

type Turn = { role: "customer" | "assistant" | "system"; body: string };

type Tenant = {
  slug: string;
  name: string;
  logoUrl: string | null;
  serviceArea: string | null;
  privacyPolicyUrl: string | null;
};

/** A submitted-but-unconfirmed customer turn, kept visible through failures. */
type Pending = { answer: string; label: string; step: string | null };

/**
 * Public AI quote conversation. Nothing is priced, promised or booked here: the
 * assistant collects details from the tenant's own approved service list and the
 * owner reviews every enquiry. No SMS is sent on this path.
 *
 * This file is presentation only — every prompt, option and message comes from
 * the server state machine. Tenant name, logo, service area and services are all
 * supplied by the tenant-scoped loader / conversation state; nothing is hard-coded.
 */
export function AiQuoteChat({ tenant }: { tenant: Tenant }) {
  const start = useServerFn(startQuoteConversation);
  const reply = useServerFn(replyQuoteConversation);
  const resume = useServerFn(resumeQuoteConversation);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState<WebChatPrompt | null>(null);
  const [draft, setDraft] = useState("");
  /** First name of a contact recognised via their personal campaign link. */
  const [returningName, setReturningName] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<null | "completed" | "declined">(null);
  const [honeypot, setHoneypot] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  /** Local-only: the customer chose "Something else" and is describing it. */
  const [describing, setDescribing] = useState(false);
  /** Local-only: the customer typed their own request, so the service list
   *  stays hidden until they ask to see it again. */
  const [listHidden, setListHidden] = useState(false);
  /** Optimistic customer bubble; survives errors so the message never vanishes. */
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

  const busy = starting || sending;

  /** Opens the conversation. Also used by the retry control when opening fails. */
  async function begin() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setError(null);
    try {
      // Refresh-safe: an in-progress conversation for this tenant is resumed so
      // any corrections the customer already made are still there.
      const storageKey = `bookedsecure:chat:${tenant.slug}`;
      const saved = typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey);
      if (saved) {
        const resumed = await resume({ data: { slug: tenant.slug, conversation_id: saved } });
        if (resumed.ok) {
          setConversationId(resumed.state.conversationId);
          setTurns(resumed.state.messages);
          setPrompt(resumed.state.prompt);
          setReturningName(window.sessionStorage.getItem(`${storageKey}:name`));
          return;
        }
        window.sessionStorage.removeItem(storageKey);
      }
      // A campaign link carries the contact's private token (?c=…) so the chat
      // recognises them and never re-asks details we already have.
      const campaignToken =
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("c");
      const result = await start({ data: { slug: tenant.slug, company: "", c: campaignToken } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.sessionStorage.setItem(storageKey, result.state.conversationId);
      if (result.state.returningName) {
        window.sessionStorage.setItem(`${storageKey}:name`, result.state.returningName);
      }
      setConversationId(result.state.conversationId);
      setTurns(result.state.messages);
      setPrompt(result.state.prompt);
      setReturningName(result.state.returningName ?? null);
    } catch {
      setError("We couldn't start the conversation. Please try again.");
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }

  useEffect(() => {
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.slug]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, busy, prompt?.step, finished, describing, pending?.answer, error]);

  // Display-only: the stored introduction and service-step instruction are not
  // shown; one concise opening message with the service list leads instead.
  const visibleTurns = useMemo(
    () => turns.filter((turn) => !isSuppressedOpeningTurn(turn.body)),
    [turns],
  );


  const onServiceStep = prompt?.step === "service" && prompt.kind === "choice";
  const serviceOptions = onServiceStep && !listHidden ? (prompt?.options ?? []) : [];
  const onBookingStep = prompt?.step === "booking" && prompt.kind === "choice";
  const bookingOptions = onBookingStep ? (prompt?.options ?? []) : [];
  const onBookingConfirmStep = prompt?.step === "booking_confirm" && prompt.kind === "choice";


  /**
   * Single-flight send. The customer bubble is appended before the request, the
   * composer clears immediately, and a replay of the same turn carries the same
   * expected step so the server never applies it twice.
   */
  async function submit(turn: Pending) {
    if (!conversationId || inFlight.current || honeypot.trim().length > 0) return;
    const value = turn.answer.trim();
    if (!value) return;

    inFlight.current = true;
    setSending(true);
    setError(null);
    setPending({ ...turn, answer: value });
    setDraft("");
    try {
      const result = await reply({
        data: {
          slug: tenant.slug,
          conversation_id: conversationId,
          answer: value,
          form_url: `${window.location.origin}${window.location.pathname}`,
          expected_step: turn.step,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTurns(result.state.messages);
      setPrompt(result.state.prompt);
      setPending(null);
      setDescribing(false);
      if (result.state.declined || result.state.completed) {
        // Finished conversations are not resumable; a refresh starts fresh.
        window.sessionStorage.removeItem(`bookedsecure:chat:${tenant.slug}`);
      }
      if (result.state.declined) setFinished("declined");
      else if (result.state.completed) setFinished("completed");
    } catch {
      setError("We couldn't send that. Please try again.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function send(answer: string, label?: string) {
    void submit({ answer, label: label ?? answer, step: prompt?.step ?? null });
  }

  // A booked customer keeps the message box so they can ask for a change; the
  // request goes to the business for review and never moves the booking itself.
  // Typing is available at every step, including the time list, consent and the
  // final confirmation: the buttons are a shortcut, never the only way through.
  const showComposer =
    finished === "completed" ||
    (!finished &&
      (prompt !== null || describing || conversationId !== null));

  const canSend = !busy && draft.trim().length > 0;

  const customerBubble = (body: string) => (
    <Message from="user" className="ml-auto max-w-[86%]">
      <MessageContent className="bg-[color:var(--chat-user)] px-3.5 py-2.5 text-[color:var(--chat-user-foreground)]">
        <p className="whitespace-pre-wrap break-words leading-relaxed">{body}</p>
      </MessageContent>
    </Message>
  );

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden sm:py-6">
        {/* Branded header — standalone, stable, never scrolls with the transcript */}
        <header className="brand-wash grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:rounded-lg sm:border sm:px-5 sm:pt-3">
          <div className="relative shrink-0">
            <TenantMark name={tenant.name} logoUrl={tenant.logoUrl} size={44} />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold sm:text-lg">{tenant.name}</h1>
            <p className="truncate text-xs text-muted-foreground">
              Quote assistant<span className="sr-only">, online</span>
              {tenant.serviceArea ? ` · ${tenant.serviceArea}` : ""}
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-[10px] font-medium text-muted-foreground">Powered securely by</p>
            <p className="font-heading text-xs font-semibold text-primary">BookedSecure</p>
          </div>
        </header>

        {/* Conversation column: ~two-thirds of the frame on desktop, full width on mobile */}
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:w-2/3 lg:min-w-[640px] lg:max-w-[900px]">
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="gap-3 px-3 py-4 sm:px-6" aria-live="polite">
            <div className="w-full">
              <ul className="flex flex-col gap-3">
                {visibleTurns.map((turn, index) => {
                  const isCustomer = turn.role === "customer";
                  return (
                    <li
                      key={`${index}-${turn.body.slice(0, 16)}`}
                      className={`flex items-end gap-2 ${isCustomer ? "flex-row-reverse" : ""}`}
                    >
                      {isCustomer ? (
                        customerBubble(turn.body)
                      ) : (
                        <>
                          <TenantMark
                            name={tenant.name}
                            logoUrl={tenant.logoUrl}
                            size={28}
                            className="rounded-full"
                          />
                          <Message from="assistant" className="max-w-[82%]">
                            <MessageContent><p className="whitespace-pre-wrap break-words leading-relaxed">{turn.body}</p></MessageContent>
                          </Message>
                        </>
                      )}
                    </li>
                  );
                })}

                {/* One assistant message: a single short welcome line followed by
                    the tenant's own selectable service list. */}
                {!busy &&
                  !pending &&
                  !finished &&
                  !describing &&
                  onServiceStep &&
                  serviceOptions.length > 0 && (
                    <li className="flex items-end gap-2">
                      <TenantMark
                        name={tenant.name}
                        logoUrl={tenant.logoUrl}
                        size={28}
                        className="rounded-full"
                      />
                       <div className="max-w-[88%] space-y-3 border-l-2 border-primary pl-3 text-sm leading-relaxed">
                        <p>
                          {returningName
                            ? `Welcome back, ${returningName}! Thanks for choosing ${tenant.name} again. Choose a service or tell us what you need.`
                            : `Hi, welcome to ${tenant.name}. Choose a service or tell us what you need.`}
                        </p>
                        <ul className="space-y-1">
                          {serviceOptions.map((option) => {
                            const isFlexible = option.value === FLEXIBLE_CHOICE;
                            const label = isFlexible
                              ? "Something else or not sure? Type your request below."
                              : option.label;
                            return (
                              <li key={option.value} className="flex items-start gap-2">
                                <span
                                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                                  aria-hidden="true"
                                />
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={
                                    isFlexible
                                      ? "Something else or not sure, type your own request"
                                      : `Choose ${option.label}`
                                  }
                                  onClick={() => {
                                    setSelected(option.value);
                                    if (isFlexible) {
                                      setDescribing(true);
                                      setListHidden(true);
                                      setError(null);
                                      requestAnimationFrame(() => input.current?.focus());
                                      return;
                                    }
                                    send(option.value, option.label);
                                  }}
                                   className={`w-full rounded-md border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:border-primary hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                                    selected === option.value ? "text-primary" : ""
                                  } ${
                                    isFlexible
                                       ? "font-normal text-muted-foreground"
                                       : "font-semibold"
                                  }`}

                                >
                                  {label}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                    </li>
                  )}

                {describing && !pending && (
                  <>
                    <li className="flex flex-row-reverse items-end gap-2">
                      {customerBubble("Something else or not sure")}
                    </li>
                    {!busy && (
                      <li className="flex items-end gap-2">
                        <TenantMark
                          name={tenant.name}
                          logoUrl={tenant.logoUrl}
                          size={28}
                          className="rounded-full"
                        />
                         <p className="max-w-[85%] border-l-2 border-primary pl-3 text-sm leading-relaxed">
                          No worries, tell me what you need in your own words below.
                        </p>
                      </li>
                    )}
                  </>
                )}


                {/* Optimistic customer turn — shown before the assistant replies */}
                {pending && (
                  <li className="flex flex-row-reverse items-end gap-2">
                    {customerBubble(pending.label)}
                  </li>
                )}

                {busy && (
                  <li className="flex items-end gap-2">
                    <TenantMark
                      name={tenant.name}
                      logoUrl={tenant.logoUrl}
                      size={28}
                      className="rounded-full"
                    />
                    <span className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-secondary px-3.5 py-3">
                      <span className="sr-only">Assistant is typing</span>
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
                          style={{ animationDelay: `${dot * 120}ms` }}
                        />
                      ))}
                    </span>
                  </li>
                )}
              </ul>




              {/* Final review — every field individually changeable */}
              {!finished && !busy && !pending && prompt?.kind === "review" && (
                <div className="mt-4 space-y-3 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <ul className="divide-y divide-border">
                    {(prompt.fields ?? []).map((field) => (
                      <li
                        key={field.step}
                        className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs text-muted-foreground">{field.label}</span>
                          <span className="block break-words text-sm">{field.value}</span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => send(`change:${field.step}`, `Change my ${field.label.toLowerCase()}`)}
                          className="min-h-9 shrink-0 rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          aria-label={`Change ${field.label}`}
                        >
                          Change
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send("confirmed", "That all looks right")}
                    className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    That all looks right
                  </button>
                </div>
              )}

              {/* Pilot booking step — every time shown is server-computed */}
              {!finished && !busy && !pending && onBookingStep && bookingOptions.length > 0 && (
                <div className="mt-4 space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm">
                  {bookingOptions
                    .filter((option) => option.value !== NO_SLOT_CHOICE)
                    .map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        onClick={() => send(option.value, option.label)}
                        aria-label={`Book ${option.label}`}
                        className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send(NO_SLOT_CHOICE, "None of these work")}
                    className="min-h-11 w-full rounded-md border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    None of these work
                  </button>
                </div>
              )}

              {/* Final confirmation — nothing is booked until this is pressed */}
              {!finished && !busy && !pending && onBookingConfirmStep && (
                <div className="mt-4 space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send(BOOKING_CONFIRM_CHOICE, "Yes, confirm this booking")}
                    className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    Yes, confirm this booking
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send(BOOKING_CHANGE_CHOICE, "Pick a different time")}
                    className="min-h-11 w-full rounded-md border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    Pick a different time
                  </button>
                </div>
              )}


              {/* Consent */}
              {!finished && !busy && !pending && prompt?.kind === "consent" && (
                <div className="mt-4 space-y-3 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <p className="text-xs text-muted-foreground">
                    See our{" "}
                    <a
                      href={tenant.privacyPolicyUrl ?? "/privacy"}
                      className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      privacy policy
                    </a>
                    .
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send("granted", "Yes, that's fine")}
                      className="min-h-11 flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      Yes, that's fine
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send("declined", "No thanks")}
                      className="min-h-11 rounded-md border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <p className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </p>
                  {!pending && !conversationId && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void begin()}
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Try again
                    </button>
                  )}
                  {pending && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submit(pending)}
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Retry sending “{pending.label}”
                    </button>
                  )}
                </div>
              )}

              <div ref={bottom} className="h-1" />
            </div>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Composer — aligned with the conversation column */}
          <div className="shrink-0 border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            {showComposer && (
              <PromptInput
                className="rounded-lg border-input bg-background shadow-sm"
                onSubmit={() => {
                  if (!canSend) return;
                  setListHidden(!asksForServiceList(draft));
                  send(draft);
                }}
              >
                <PromptInputTextarea
                  ref={input}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    finished === "completed"
                      ? "Need to change something? Tell me here…"
                      : onServiceStep
                      ? "Or describe what you need…"
                      : prompt?.kind === "review"
                        ? "Tell me what to change…"
                        : onBookingStep
                          ? "Or type a time, like “Friday 9am”…"
                          : onBookingConfirmStep
                            ? "Or type yes to confirm…"
                            : prompt?.kind === "consent"
                              ? "Or type yes or no…"
                              : prompt?.optional
                              ? "Type your answer or “skip”"
                              : "Type your answer…"
                  }

                  maxLength={500}
                  className="min-h-12 px-3 py-3 text-sm"
                  aria-label="Your answer"
                />
                <PromptInputFooter className="justify-end">
                  <PromptInputSubmit status={sending ? "submitted" : "ready"} disabled={!canSend} aria-label={busy ? "Sending" : "Send"} />
                </PromptInputFooter>
              </PromptInput>
            )}

            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Times shown are live and booked on the spot. Prices are confirmed by {tenant.name}. Powered by BookedSecure.
              </span>
            </p>

            <div aria-hidden className="sr-only">
              <label>
                Company
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
