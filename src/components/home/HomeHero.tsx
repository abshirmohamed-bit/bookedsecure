import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, CalendarClock, Loader2, Paperclip, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { askOwnerAssistant } from "@/lib/owner-assistant.functions";
import { normaliseOwnerQuestion, OWNER_ASSISTANT_MAX_QUESTION } from "@/lib/owner-assistant";
import { previewCrmImport } from "@/lib/csv-import.functions";
import { MAX_CSV_BYTES } from "@/lib/csv-import";

const SUGGESTIONS = [
  "What's waiting on a reply?",
  "How many bookings are coming up?",
  "How did my last win-back campaign go?",
  "How many new leads this week?",
] as const;


/**
 * Signed-in home: ask a question about your own business and get a read-only
 * answer. Tenant-neutral — every number comes from the caller's own records.
 */
export function HomeHero() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const ask = useServerFn(askOwnerAssistant);
  const upload = useServerFn(previewCrmImport);
  const fileRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState(false);

  const mutation = useMutation({
    mutationFn: (value: string) => ask({ data: { question: value } }),
    onSuccess: (result) => setAnswer(result.answer),
    onError: (error) =>
      setAnswer(error instanceof Error ? error.message : "That question could not be answered."),
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

  function submit(value: string) {
    const text = normaliseOwnerQuestion(value);
    if (!text) return;
    if (!signedIn) {
      navigate({ to: "/auth" });
      return;
    }
    setQuestion(text);
    mutation.mutate(text);
  }

  function chooseFile() {
    if (!signedIn) {
      navigate({ to: "/auth" });
      return;
    }
    fileRef.current?.click();
  }


  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5">
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

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-20">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about your business.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Leads, bookings, replies and win-back campaigns — answered from your own records. Nothing
          is sent or changed from here.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(question);
          }}
          className="mt-6 rounded-2xl border border-border bg-card p-3 shadow-sm"
        >
          <label className="sr-only" htmlFor="owner-question">
            Ask a question about your business
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
            placeholder="How many leads are waiting on a reply?"
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-xs text-muted-foreground">
              {loading ? "Checking your access…" : signedIn ? "Read-only answers" : "Sign in to ask"}
            </span>
            <button
              type="submit"
              aria-label="Ask"
              disabled={mutation.isPending || normaliseOwnerQuestion(question).length === 0}
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submit(suggestion)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {answer ? (
          <div
            role="status"
            className="mt-6 rounded-xl border border-border bg-secondary/40 p-4 text-sm leading-relaxed"
          >
            {answer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
