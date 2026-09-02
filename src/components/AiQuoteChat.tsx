import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Loader2, RotateCcw, Send, ShieldCheck, User } from "lucide-react";
import { TenantMark } from "@/components/TenantMark";
import {
  replyQuoteConversation,
  resumeQuoteConversation,
  startQuoteConversation,
} from "@/lib/web-chat.functions";
import { isVerboseIntro } from "@/lib/web-chat-presentation";
import { FLEXIBLE_CHOICE, type WebChatPrompt } from "@/lib/web-chat";
import { NO_SLOT_CHOICE } from "@/lib/web-chat-booking";

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
  const [starting, setStarting] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<null | "completed" | "declined">(null);
  const [honeypot, setHoneypot] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  /** Local-only: the customer chose "Something else" and is describing it. */
  const [describing, setDescribing] = useState(false);
  /** Optimistic customer bubble; survives errors so the message never vanishes. */
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

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
          return;
        }
        window.sessionStorage.removeItem(storageKey);
      }
      const result = await start({ data: { slug: tenant.slug, company: "" } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.sessionStorage.setItem(storageKey, result.state.conversationId);
      setConversationId(result.state.conversationId);
      setTurns(result.state.messages);
      setPrompt(result.state.prompt);
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

  // Display-only: the stored long introduction is not shown in the opening
  // conversation; the short instruction leads instead.
  const visibleTurns = useMemo(() => turns.filter((turn) => !isVerboseIntro(turn.body)), [turns]);

  const onServiceStep = prompt?.step === "service" && prompt.kind === "choice";
  const serviceOptions = onServiceStep ? (prompt?.options ?? []) : [];
  const onBookingStep = prompt?.step === "booking" && prompt.kind === "choice";
  const bookingOptions = onBookingStep ? (prompt?.options ?? []) : [];


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

  const showComposer =
    !finished &&
    (prompt?.kind === "text" || prompt?.kind === "review" || describing || onServiceStep || (!prompt && conversationId !== null));
  const canSend = !busy && draft.trim().length > 0;

  const customerBubble = (body: string) => (
    <>
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"
        aria-hidden="true"
      >
        <User className="h-3.5 w-3.5" />
      </span>
      <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[color:var(--chat-user)] px-3.5 py-2.5 text-sm leading-relaxed text-[color:var(--chat-user-foreground)]">
        {body}
      </p>
    </>
  );

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden sm:py-6">
        {/* Branded header — standalone, stable, never scrolls with the transcript */}
        <header className="grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 overflow-hidden border-b border-border bg-[image:var(--gradient-chat-header)] px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:rounded-2xl sm:border sm:px-6 sm:pt-4">
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
        </header>

        {/* Conversation column: ~two-thirds of the frame on desktop, full width on mobile */}
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:w-2/3 lg:min-w-[640px] lg:max-w-[900px]">
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
            aria-live="polite"
          >
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
                          <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-secondary-foreground">
                            {turn.body}
                          </p>
                        </>
                      )}
                    </li>
                  );
                })}

                {/* One natural assistant message: intro line, the tenant's own
                    selectable service list, then a single follow-up question. */}
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
                      <div className="max-w-[85%] space-y-2.5 rounded-2xl rounded-bl-md bg-secondary px-3.5 py-3 text-sm leading-relaxed text-secondary-foreground">
                        <p>
                          We offer a range of services
                          {tenant.serviceArea ? ` across ${tenant.serviceArea}` : ""}, including:
                        </p>
                        <ul className="space-y-1">
                          {serviceOptions.map((option) => {
                            const isFlexible = option.value === FLEXIBLE_CHOICE;
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
                                      ? "Something else or not sure — describe your own request"
                                      : `Choose ${option.label}`
                                  }
                                  onClick={() => {
                                    setSelected(option.value);
                                    if (isFlexible) {
                                      setDescribing(true);
                                      setError(null);
                                      requestAnimationFrame(() => input.current?.focus());
                                      return;
                                    }
                                    send(option.value, option.label);
                                  }}
                                  className={`-mx-1 rounded-lg px-1 text-left font-semibold underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                                    selected === option.value ? "text-primary" : ""
                                  } ${isFlexible ? "font-medium italic" : ""}`}
                                >
                                  {option.label}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <p>Are you mainly looking to clean up the interior, the exterior, or both?</p>
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
                        <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-secondary-foreground">
                          No worries — tell me what you need in your own words below.
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
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-card/60 p-3">
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
                          className="min-h-9 shrink-0 rounded-full border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
                    className="min-h-11 w-full rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    That all looks right
                  </button>
                </div>
              )}

              {/* Pilot booking step — every time shown is server-computed */}
              {!finished && !busy && !pending && onBookingStep && bookingOptions.length > 0 && (
                <div className="mt-4 space-y-2 rounded-xl border border-border bg-card/60 p-3">
                  {bookingOptions
                    .filter((option) => option.value !== NO_SLOT_CHOICE)
                    .map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        onClick={() => send(option.value, option.label)}
                        aria-label={`Book ${option.label}`}
                        className="min-h-11 w-full rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send(NO_SLOT_CHOICE, "None of these work")}
                    className="min-h-11 w-full rounded-full border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    None of these work
                  </button>
                </div>
              )}


              {/* Consent */}
              {!finished && !busy && !pending && prompt?.kind === "consent" && (
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-card/60 p-3">
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
                      className="min-h-11 flex-1 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      Yes, that's fine
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send("declined", "No thanks")}
                      className="min-h-11 rounded-full border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
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
          </div>

          {/* Composer — aligned with the conversation column */}
          <div className="shrink-0 border-t border-border bg-card/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            {showComposer && (
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canSend) return;
                  send(draft);
                }}
              >
                <input
                  ref={input}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    onServiceStep
                      ? "Or describe what you need…"
                      : prompt?.kind === "review"
                        ? "Tell me what to change…"
                        : prompt?.optional
                        ? "Type your answer or “skip”"
                        : "Type your answer…"
                  }
                  maxLength={500}
                  className="min-h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Your answer"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label={busy ? "Sending" : "Send"}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </form>
            )}

            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                This assistant can't confirm prices or bookings. {tenant.name} reviews every enquiry.
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
