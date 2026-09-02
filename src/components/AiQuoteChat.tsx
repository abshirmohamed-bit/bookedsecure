import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Loader2, Send, ShieldCheck, User } from "lucide-react";
import { TenantMark } from "@/components/TenantMark";
import { replyQuoteConversation, startQuoteConversation } from "@/lib/web-chat.functions";
import { isVerboseIntro, serviceShortDescription } from "@/lib/web-chat-presentation";
import { FLEXIBLE_CHOICE, type WebChatPrompt } from "@/lib/web-chat";

type Turn = { role: "customer" | "assistant" | "system"; body: string };

type Tenant = {
  slug: string;
  name: string;
  logoUrl: string | null;
  serviceArea: string | null;
  privacyPolicyUrl: string | null;
};

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

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState<WebChatPrompt | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<null | "completed" | "declined">(null);
  const [honeypot, setHoneypot] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  /** Local-only: the customer chose "Something else" and is describing it. */
  const [describing, setDescribing] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await start({ data: { slug: tenant.slug, company: "" } });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setConversationId(result.state.conversationId);
        setTurns(result.state.messages);
        setPrompt(result.state.prompt);
      } catch {
        if (!cancelled) setError("We couldn't start the conversation. Please refresh and try again.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.slug]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, busy, prompt?.step, finished, describing]);

  // Display-only: the stored long introduction is not shown in the opening
  // conversation; the short instruction leads instead.
  const visibleTurns = useMemo(
    () => turns.filter((turn) => !isVerboseIntro(turn.body)),
    [turns],
  );

  const onServiceStep = prompt?.step === "service" && prompt.kind === "choice";
  const serviceOptions = onServiceStep ? (prompt?.options ?? []) : [];

  async function send(answer: string) {
    if (!conversationId || busy || honeypot.trim().length > 0) return;
    const value = answer.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const result = await reply({
        data: {
          slug: tenant.slug,
          conversation_id: conversationId,
          answer: value,
          form_url: `${window.location.origin}${window.location.pathname}`,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTurns(result.state.messages);
      setPrompt(result.state.prompt);
      setDescribing(false);
      if (result.state.declined) setFinished("declined");
      else if (result.state.completed) setFinished("completed");
    } catch {
      setError("We couldn't send that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const showComposer =
    !finished &&
    (prompt?.kind === "text" || describing || onServiceStep || (!prompt && conversationId !== null));
  const canSend = !busy && draft.trim().length > 0;

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden sm:py-6">
        <div className="panel flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none p-0 sm:rounded-2xl">
          {/* Branded header */}
          <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-[image:var(--gradient-chat-header)] px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-4">
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

          {/* Conversation */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
            aria-live="polite"
          >
            <div className="mx-auto w-full max-w-3xl">
              <ul className="flex flex-col gap-3">
                {visibleTurns.map((turn, index) => {
                  const isCustomer = turn.role === "customer";
                  return (
                    <li
                      key={`${index}-${turn.body.slice(0, 16)}`}
                      className={`flex items-end gap-2 ${isCustomer ? "flex-row-reverse" : ""}`}
                    >
                      {isCustomer ? (
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"
                          aria-hidden="true"
                        >
                          <User className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <TenantMark
                          name={tenant.name}
                          logoUrl={tenant.logoUrl}
                          size={28}
                          className="rounded-full"
                        />
                      )}
                      <p
                        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          isCustomer
                            ? "rounded-br-md bg-[color:var(--chat-user)] text-[color:var(--chat-user-foreground)]"
                            : "rounded-bl-md bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {turn.body}
                      </p>
                    </li>
                  );
                })}

                {/* Tenant service-list message, built from the tenant's own options */}
                {!busy && !finished && onServiceStep && serviceOptions.length > 0 && (
                  <li className="flex items-end gap-2">
                    <TenantMark
                      name={tenant.name}
                      logoUrl={tenant.logoUrl}
                      size={28}
                      className="rounded-full"
                    />
                    <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-secondary-foreground">
                      <p>
                        We offer a variety of mobile detailing services
                        {tenant.serviceArea ? ` across ${tenant.serviceArea}` : ""}, including:
                      </p>
                    </div>
                  </li>
                )}

                {describing && (
                  <li className="flex flex-row-reverse items-end gap-2">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"
                      aria-hidden="true"
                    >
                      <User className="h-3.5 w-3.5" />
                    </span>
                    <p className="max-w-[80%] rounded-2xl rounded-br-md bg-[color:var(--chat-user)] px-3.5 py-2.5 text-sm leading-relaxed text-[color:var(--chat-user-foreground)]">
                      Something else or not sure
                    </p>
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

              {/* Interactive service options (service step only) */}
              {!finished && !busy && !describing && onServiceStep && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {serviceOptions.map((option) => {
                    const isFlexible = option.value === FLEXIBLE_CHOICE;
                    const description = isFlexible ? "" : serviceShortDescription(option.detail);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        aria-label={
                          isFlexible
                            ? "Something else or not sure — describe your own request"
                            : `Choose ${option.label}`
                        }
                        onClick={() => {
                          if (isFlexible) {
                            setSelected(option.value);
                            setDescribing(true);
                            setError(null);
                            requestAnimationFrame(() => input.current?.focus());
                            return;
                          }
                          setSelected(option.value);
                          void send(option.value);
                        }}
                        className={`flex min-h-11 w-full flex-col justify-center rounded-xl border px-3.5 py-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                          selected === option.value
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card/60"
                        } ${isFlexible ? "sm:col-span-2 lg:col-span-3" : ""}`}
                      >
                        <span className="truncate text-sm font-semibold">{option.label}</span>
                        {description && (
                          <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Follow-up question, after the options */}
              {!finished && !busy && onServiceStep && (
                <p className="mt-4 max-w-[80%] rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-secondary-foreground sm:ml-9">
                  {describing
                    ? "No worries — tell me what you need in your own words below."
                    : "Are you mainly looking to clean up the interior, exterior, or both?"}
                </p>
              )}

              {/* Consent */}
              {!finished && !busy && prompt?.kind === "consent" && (
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
                      onClick={() => send("granted")}
                      className="min-h-11 flex-1 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      Yes, that's fine
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send("declined")}
                      className="min-h-11 rounded-full border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </p>
              )}

              <div ref={bottom} className="h-1" />
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border bg-card/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            <div className="mx-auto w-full max-w-3xl">
              {showComposer && (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send(draft);
                  }}
                >
                  <input
                    ref={input}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      onServiceStep
                        ? "Or describe what you need…"
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
                  This assistant can't confirm prices or bookings. {tenant.name} reviews every
                  enquiry.
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
      </div>
    </main>
  );
}
