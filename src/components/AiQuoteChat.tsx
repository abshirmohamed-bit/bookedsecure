import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Send } from "lucide-react";
import { TenantMark } from "@/components/TenantMark";
import { replyQuoteConversation, startQuoteConversation } from "@/lib/web-chat.functions";
import type { WebChatPrompt } from "@/lib/web-chat";

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
  const bottom = useRef<HTMLDivElement | null>(null);

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
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);

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
      if (result.state.declined) setFinished("declined");
      else if (result.state.completed) setFinished("completed");
    } catch {
      setError("We couldn't send that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <header className="mb-4 flex items-center gap-3">
          <TenantMark name={tenant.name} logoUrl={tenant.logoUrl} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{tenant.name}</h1>
            <p className="text-xs text-muted-foreground">
              {tenant.serviceArea ?? "Mobile detailing"} — online quote assistant
            </p>
          </div>
        </header>

        <div className="panel flex flex-col p-4">
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1" aria-live="polite">
            {turns.map((turn, index) => (
              <div
                key={`${index}-${turn.body.slice(0, 12)}`}
                className={turn.role === "customer" ? "flex justify-end" : "flex justify-start"}
              >
                <p
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    turn.role === "customer"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  {turn.body}
                </p>
              </div>
            ))}
            {busy && <p className="text-xs text-muted-foreground">Typing…</p>}
            <div ref={bottom} />
          </div>

          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          {!finished && prompt?.kind === "choice" && (
            <div className="mt-4 space-y-2">
              {(prompt.options ?? []).map((option) => (
                <button
                  key={option.value}
                  disabled={busy}
                  onClick={() => send(option.value)}
                  className="w-full rounded-md border border-input px-3 py-2 text-left text-sm hover:border-primary disabled:opacity-50"
                >
                  <span className="block font-medium">{option.label}</span>
                  {option.detail && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!finished && prompt?.kind === "consent" && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                See our{" "}
                <a href={tenant.privacyPolicyUrl ?? "/privacy"} className="text-primary underline">
                  privacy policy
                </a>
                .
              </p>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => send("granted")}
                  className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Yes, that's fine
                </button>
                <button
                  disabled={busy}
                  onClick={() => send("declined")}
                  className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
                >
                  No thanks
                </button>
              </div>
            </div>
          )}

          {!finished && (prompt?.kind === "text" || (!prompt && !finished && conversationId)) && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={prompt?.optional ? "Type your answer or “skip”" : "Type your answer"}
                maxLength={500}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-label="Your answer"
              />
              <button
                type="submit"
                disabled={busy || draft.trim().length === 0}
                className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
                aria-label="Send"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          )}

          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
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

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          This assistant can't confirm prices or bookings. {tenant.name} reviews every enquiry.
        </p>
      </div>
    </main>
  );
}
