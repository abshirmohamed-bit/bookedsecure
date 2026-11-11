import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Clapperboard, History, Loader2, MessageCircle, PenLine, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OwnerAssistant, type CoworkComposerApi, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { EngineDot } from "@/components/social/EngineDot";
import { SocialResults, YourChannels } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { getSession } from "@/lib/app.functions";
import { getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";
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
 * Social media's front page. Co-Work itself is OwnerAssistant, the same one as
 * Home and the Co-Work page; this screen only arranges it with starters, the
 * connected channels and a running list of results.
 */
export function SocialCowork() {
  const qc = useQueryClient();
  const getHome = useServerFn(getAssistantHome);
  const getConversation = useServerFn(getAssistantConversation);
  const fetchSession = useServerFn(getSession);
  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const threadId = home.data?.ongoing.id;
  const conversation = useQuery({ queryKey: ["assistant-conversation", threadId], enabled: Boolean(threadId), queryFn: () => getConversation({ data: { threadId: threadId as string } }) });
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });

  const [chatting, setChatting] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>();
  const [greeting, setGreeting] = useState("Hello");
  const composer = useRef<CoworkComposerApi | null>(null);
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);

  const write = (text: string) => setSeed({ text, nonce: Date.now() });
  const askFromResults = (text: string) => { setResultsOpen(false); write(text); };
  const firstName = session.data?.name?.trim().split(/\s+/)[0];

  const turns: OwnerAssistantTurn[] = useMemo(() => (conversation.data?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "you" : "assistant",
    text: message.text,
    ...(message.proposals.length ? { proposals: message.proposals as NonNullable<OwnerAssistantTurn["proposals"]> } : {}),
    ...(message.done ? { done: message.done } : {}),
  })), [conversation.data]);

  if (home.isError || conversation.isError) {
    return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Co-Work couldn't be opened here. Refresh the page to try again.</div>;
  }
  if (!threadId || conversation.isLoading) {
    return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Opening Co-Work" /></div>;
  }

  const starters = (
    <section>
      <SectionTitle>Start with</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {STARTERS.map((s) => (
          <button key={s.title} type="button" onClick={() => (s.video ? composer.current?.chooseVideo() : write(s.prompt))} className={`flex min-h-[4.5rem] items-center gap-2.5 rounded-2xl bg-gradient-to-br ${s.tint} p-3 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5`}>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20"><s.icon className="size-4" aria-hidden="true" /></span>
            <span className="text-[13px] font-semibold leading-tight">{s.title}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const resultsHeader = (
    <div className="flex items-center justify-between">
      <h2 className="font-heading text-lg font-semibold">Results</h2>
      <EngineDot onAsk={askFromResults} />
    </div>
  );

  const hero = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5 lg:flex-none lg:overflow-visible lg:pb-1 lg:pt-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{greeting}{firstName ? `, ${firstName}` : ""}</p>
            <h1 className="mt-0.5 text-balance font-heading text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]">
              What should we <span className="cowork-accent">post</span> today?
            </h1>
          </div>
          {turns.length > 0 ? (
            <button type="button" onClick={() => setChatting(true)} className="-ml-3 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10 lg:ml-0">
              <History className="size-3.5" aria-hidden="true" /> Carry on your conversation
            </button>
          ) : null}
        </header>
        <div className="mt-5 space-y-6 lg:hidden">
          {starters}
          <section>
            {resultsHeader}
            <div className="mt-1"><SocialResults onAsk={askFromResults} /></div>
          </section>
          <section><SectionTitle>Your channels</SectionTitle><YourChannels /></section>
        </div>
      </div>
    </div>
  );

  const belowComposer = (
    <div className="mx-auto mt-5 hidden w-[calc(100%-2rem)] max-w-4xl space-y-6 lg:block">
      {starters}
      <section><SectionTitle>Your channels</SectionTitle><YourChannels /></section>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {chatting ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
            <Button variant="ghost" size="sm" className="min-h-10" onClick={() => setChatting(false)}><ArrowLeft className="size-4" aria-hidden="true" />New request</Button>
            <Button variant="outline" size="sm" className="min-h-10 lg:hidden" onClick={() => setResultsOpen(true)}><Sparkles className="size-4" aria-hidden="true" />Results</Button>
          </div>
        ) : null}
        <OwnerAssistant
          key={threadId}
          threadId={threadId}
          initialTurns={turns}
          hideTurns={!chatting}
          hero={hero}
          belowComposer={belowComposer}
          seed={seed}
          composerApi={composer}
          placeholder="Ask for a post, drop in a video, or say what's on your mind…"
          composerClassName="cowork-ring relative z-20 mx-auto mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-2 w-[calc(100%-1.5rem)] max-w-4xl shrink-0 rounded-[1.25rem] sm:w-[calc(100%-2rem)] lg:mb-0 lg:mt-5"
          onStart={() => setChatting(true)}
          onConversationChanged={() => { void qc.invalidateQueries({ queryKey: ["assistant-home"] }); }}
        />
      </div>

      <aside aria-label="Results" className="hidden h-full min-h-0 w-[22rem] shrink-0 overflow-y-auto border-l border-border/60 p-4 lg:block xl:w-96">
        <div className="mb-3">{resultsHeader}</div>
        <SocialResults onAsk={askFromResults} />
      </aside>

      <Drawer open={resultsOpen} onOpenChange={setResultsOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <div className="flex items-center justify-between px-4 pt-2"><DrawerTitle className="font-heading text-lg">Results</DrawerTitle><EngineDot onAsk={askFromResults} /></div>
          <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SocialResults onAsk={askFromResults} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
