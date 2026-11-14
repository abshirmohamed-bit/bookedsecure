import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Clapperboard, History, Loader2, Maximize2, MessageCircle, PenLine, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CoworkHistory } from "@/components/cowork/CoworkHistory";
import { CoworkKnows } from "@/components/cowork/CoworkKnows";
import { CoworkRoutines } from "@/components/cowork/CoworkRoutines";
import { CoworkGateways } from "@/components/cowork/CoworkGateways";
import { OwnerAssistant, type CoworkComposerApi, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { Portal } from "@/components/Portal";
import { SiteOnboardingPanel } from "@/components/settings/SiteOnboardingPanel";
import { EngineDot } from "@/components/social/EngineDot";
import { SocialResults, YourChannels } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { getSession } from "@/lib/app.functions";
import { clearAssistantConversation, createAssistantConversation, deleteAssistantConversation, getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";
import { greetingFor } from "@/lib/social-cowork";

type Starter = { title: string; prompt: string; icon: LucideIcon; tint: string; video?: boolean };

// Worded for any kind of business; Co-Work fills in the specifics from its profile.
const STARTERS: Starter[] = [
  { title: "Turn a long video into shorts", prompt: "", icon: Clapperboard, tint: "from-[oklch(0.45_0.15_258)] to-[oklch(0.62_0.15_245)]", video: true },
  { title: "Write this week's post", prompt: "Write this week's post about what we do best. Show it to me before anything goes out.", icon: PenLine, tint: "from-[oklch(0.58_0.13_222)] to-[oklch(0.74_0.11_195)]" },
  { title: "Answer my comments", prompt: "Which comments and messages are waiting for a reply? Suggest what to say to each.", icon: MessageCircle, tint: "from-[oklch(0.53_0.17_256)] to-[oklch(0.68_0.13_225)]" },
  { title: "What's working lately?", prompt: "Look at my recent posts and tell me what's working and what to post next.", icon: TrendingUp, tint: "from-[oklch(0.38_0.13_260)] to-[oklch(0.56_0.14_240)]" },
];

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-2 text-sm font-semibold">{children}</h2>;
}

/**
 * Co-Work's page on /assistant and /social. Co-Work itself is OwnerAssistant
 * (the same agent and thread store everywhere); this only arranges it: the
 * greeting, starters and channels above a composer pinned to the bottom, and
 * once a conversation is open, a full-width chat with starters, channels and
 * results in the right-hand column. History is a dropdown in the top right.
 */
export function CoworkWorkspace({
  requestedThreadId,
  routeThreads = false,
  headline,
}: {
  /** Open this conversation (from /assistant/$threadId). */
  requestedThreadId?: string;
  /** Picking a conversation changes the URL (/assistant) instead of local state (/social). */
  routeThreads?: boolean;
  headline: ReactNode;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getHome = useServerFn(getAssistantHome);
  const getConversation = useServerFn(getAssistantConversation);
  const createConversation = useServerFn(createAssistantConversation);
  const deleteConversation = useServerFn(deleteAssistantConversation);
  const clearConversation = useServerFn(clearAssistantConversation);
  const fetchSession = useServerFn(getSession);
  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const [localId, setLocalId] = useState<string | undefined>();
  const threadId = requestedThreadId ?? localId ?? home.data?.ongoing.id;
  const conversation = useQuery({ queryKey: ["assistant-conversation", threadId], enabled: Boolean(threadId), queryFn: () => getConversation({ data: { threadId: threadId as string } }) });
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });

  // null = not chosen yet: an ongoing conversation opens on screen by itself.
  const [chatChoice, setChatting] = useState<boolean | null>(requestedThreadId ? true : null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsWide, setResultsWide] = useState(false);
  const [websiteSetup, setWebsiteSetup] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>();
  const [greeting, setGreeting] = useState("Hello");
  const composer = useRef<CoworkComposerApi | null>(null);
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);
  useEffect(() => { if (requestedThreadId) setChatting(true); }, [requestedThreadId]);

  const selectThread = (id: string, chat = true) => {
    setChatting(chat);
    if (routeThreads) navigate({ to: "/assistant/$threadId", params: { threadId: id } });
    else setLocalId(id);
  };
  const createThread = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: async (thread) => { await qc.invalidateQueries({ queryKey: ["assistant-home"] }); selectThread(thread.id, false); },
    onError: (error: Error) => toast.error(error.message),
  });
  const clearThread = useMutation({
    mutationFn: (id: string) => clearConversation({ data: { threadId: id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["assistant-conversation"] });
      await qc.invalidateQueries({ queryKey: ["assistant-home"] });
      setChatting(false);
      toast.success("Chat cleared.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeThread = useMutation({
    mutationFn: (id: string) => deleteConversation({ data: { threadId: id } }),
    onSuccess: async (ongoing, id) => {
      await qc.invalidateQueries({ queryKey: ["assistant-home"] });
      await qc.invalidateQueries({ queryKey: ["assistant-conversation"] });
      if (id === threadId) selectThread(ongoing.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const write = (text: string) => setSeed({ text, nonce: Date.now() });
  const askFromResults = (text: string) => { setResultsOpen(false); setResultsWide(false); write(text); };
  const firstName = session.data?.name?.trim().split(/\s+/)[0];

  const turns: OwnerAssistantTurn[] = useMemo(() => (conversation.data?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "you" : "assistant",
    text: message.text,
    ...(message.proposals.length ? { proposals: message.proposals as NonNullable<OwnerAssistantTurn["proposals"]> } : {}),
    ...(message.done ? { done: message.done } : {}),
  })), [conversation.data]);
  const chatting = chatChoice ?? turns.length > 0;

  if (home.isError || conversation.isError) {
    return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Co-Work couldn't be opened here. Refresh the page to try again.</div>;
  }
  if (!threadId || conversation.isLoading || !conversation.data) {
    return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Opening Co-Work" /></div>;
  }

  const busy = createThread.isPending || clearThread.isPending || removeThread.isPending;
  const history = (
    <span className="flex shrink-0 items-center">
    <CoworkGateways />
    <CoworkRoutines />
    <CoworkKnows />
    <CoworkHistory
      threads={conversation.data.threads}
      activeId={threadId}
      canClear={turns.length > 0}
      busy={busy}
      onSelect={(id) => selectThread(id)}
      onCreate={() => createThread.mutate()}
      onClear={() => clearThread.mutate(threadId)}
      onDelete={(id) => removeThread.mutate(id)}
      onWebsiteSetup={session.data?.role === "owner" ? () => setWebsiteSetup(true) : undefined}
    />
    </span>
  );

  const starters = (narrow: boolean) => (
    <section>
      <SectionTitle>Start with</SectionTitle>
      <div className={`grid grid-cols-2 gap-2.5 ${narrow ? "" : "lg:grid-cols-4"}`}>
        {STARTERS.map((s) => (
          <button key={s.title} type="button" onClick={() => { setResultsOpen(false); if (s.video) composer.current?.chooseVideo(); else write(s.prompt); }} className={`flex items-center gap-2.5 rounded-2xl bg-gradient-to-br ${s.tint} text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 ${narrow ? "min-h-14 p-2.5" : "min-h-[4.5rem] p-3"}`}>
            <span className={`grid shrink-0 place-items-center rounded-xl bg-white/20 ${narrow ? "size-8" : "size-9"}`}><s.icon className="size-4" aria-hidden="true" /></span>
            <span className={`font-semibold leading-tight ${narrow ? "text-xs" : "text-[13px]"}`}>{s.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
  const channels = (narrow: boolean) => <section><SectionTitle>Your channels</SectionTitle><YourChannels narrow={narrow} /></section>;

  const resultsHeader = (
    <div className="flex items-center justify-between">
      <h2 className="font-heading text-lg font-semibold">Results</h2>
      <div className="flex items-center gap-1">
        <EngineDot onAsk={askFromResults} />
        <Link to="/studio" className="inline-flex min-h-9 items-center rounded-full px-2.5 text-xs font-medium text-primary hover:bg-primary/10">Open in Studio</Link>
        <button type="button" onClick={() => setResultsWide(true)} aria-label="Expand results" title="Expand results" className="hidden size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/60 hover:text-foreground lg:grid">
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  const hero = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5 lg:pt-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{greeting}{firstName ? `, ${firstName}` : ""}</p>
            <h1 className="mt-0.5 text-balance font-heading text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]">{headline}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ask about your business or ask for a campaign.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {turns.length > 0 ? (
              <button type="button" onClick={() => setChatting(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10">
                <History className="size-3.5 sm:hidden" aria-hidden="true" /><span className="sr-only sm:not-sr-only">Carry on your conversation</span><span className="sm:hidden">Carry on</span>
              </button>
            ) : null}
            {history}
          </div>
        </header>
        <div className="mt-6 space-y-6">
          {starters(false)}
          {channels(false)}
          <section className="lg:hidden">
            {resultsHeader}
            <div className="mt-1"><SocialResults onAsk={askFromResults} /></div>
          </section>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {chatting ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
            <Button variant="ghost" size="sm" className="min-h-10" onClick={() => setChatting(false)}><ArrowLeft className="size-4" aria-hidden="true" />New request</Button>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="min-h-10 lg:hidden" onClick={() => setResultsOpen(true)}><Sparkles className="size-4" aria-hidden="true" />Results</Button>
              {history}
            </div>
          </div>
        ) : null}
        <OwnerAssistant
          key={threadId}
          threadId={threadId}
          initialTurns={turns}
          hideTurns={!chatting}
          hero={hero}
          seed={seed}
          wide
          composerApi={composer}
          placeholder="Ask for a post, drop in a video, or say what's on your mind…"
          composerClassName={`cowork-ring relative z-20 mx-auto mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-2 w-[calc(100%-1.5rem)] shrink-0 rounded-[1.25rem] sm:w-[calc(100%-3rem)] lg:mb-4 ${chatting ? "" : "max-w-4xl"}`}
          onStart={() => setChatting(true)}
          onConversationChanged={() => { void qc.invalidateQueries({ queryKey: ["assistant-home"] }); }}
        />
      </div>

      <aside aria-label="Results" className="hidden h-full min-h-0 w-[24rem] shrink-0 overflow-y-auto border-l border-border/60 p-4 lg:block xl:w-[26rem] 2xl:w-[28rem]">
        {chatting ? <div className="mb-6 space-y-5">{starters(true)}{channels(true)}</div> : null}
        <div className="mb-3">{resultsHeader}</div>
        <SocialResults onAsk={askFromResults} />
      </aside>

      <Drawer open={resultsOpen} onOpenChange={setResultsOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <div className="flex items-center justify-between px-4 pt-2"><DrawerTitle className="font-heading text-lg">Results</DrawerTitle><EngineDot onAsk={askFromResults} /></div>
          <div className="space-y-6 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {starters(true)}
            {channels(true)}
            <SocialResults onAsk={askFromResults} />
          </div>
        </DrawerContent>
      </Drawer>

      {resultsWide ? (
        <Portal>
          <div className="fixed inset-0 z-[60] hidden bg-foreground/25 lg:block" onClick={() => setResultsWide(false)} aria-hidden="true" />
          <aside role="dialog" aria-modal="true" aria-label="Results" className="fixed inset-y-0 right-0 z-[61] hidden w-[min(64rem,calc(100vw-4rem))] flex-col border-l border-white/70 bg-background shadow-2xl lg:flex">
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="font-heading text-lg font-semibold">Results</h2>
              <div className="flex items-center gap-1">
                <EngineDot onAsk={askFromResults} />
                <button type="button" onClick={() => setResultsWide(false)} aria-label="Close results" className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" aria-hidden="true" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><SocialResults onAsk={askFromResults} wide /></div>
          </aside>
        </Portal>
      ) : null}

      {websiteSetup ? (
        <Portal>
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-3 sm:p-8">
            <div className="mx-auto max-w-5xl rounded-2xl bg-background p-4 shadow-2xl sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div><h2 className="font-heading text-lg font-semibold">Set up from your website</h2><p className="text-xs text-muted-foreground">Review everything before it is saved.</p></div>
                <button type="button" onClick={() => setWebsiteSetup(false)} className="rounded-full p-2 hover:bg-secondary" aria-label="Close website setup"><X className="size-4" /></button>
              </div>
              <SiteOnboardingPanel readOnly={false} onApplied={() => setWebsiteSetup(false)} />
            </div>
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
