import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, ChevronDown, Clapperboard, Film, History, Layers, Link2, Loader2, MessageCircle, Mic, PenLine, Plus, RectangleVertical, Sparkles, TrendingUp, Wand2, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { OwnerAssistant, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { DoItYourself, SocialResults } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSession } from "@/lib/app.functions";
import { getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";
import { greetingFor, SOCIAL_FORMATS, SOCIAL_PLATFORMS, SOCIAL_STYLES, type AssistantSurface, type SocialFormat, type SocialPlatform, type SocialStyle } from "@/lib/social-cowork";
import { MAX_VIDEO_BYTES } from "@/lib/video-clips";
import { finishVideoUpload, startVideoUpload } from "@/lib/video-clips.functions";

type Starter = { title: string; prompt: string; icon: LucideIcon; tint: string; video?: boolean };

// Worded for any kind of business; Co-work fills in the specifics from its profile.
const STARTERS: Starter[] = [
  { title: "Turn a long video into shorts", prompt: "", icon: Clapperboard, tint: "from-[oklch(0.45_0.15_258)] to-[oklch(0.62_0.15_245)]", video: true },
  { title: "Write this week's post", prompt: "Write this week's post about what we do best. Show it to me before anything goes out.", icon: PenLine, tint: "from-[oklch(0.58_0.13_222)] to-[oklch(0.74_0.11_195)]" },
  { title: "Answer my comments", prompt: "Which comments and messages are waiting for a reply? Suggest what to say to each.", icon: MessageCircle, tint: "from-[oklch(0.53_0.17_256)] to-[oklch(0.68_0.13_225)]" },
  { title: "What's working lately?", prompt: "Look at my recent posts and tell me what's working and what to post next.", icon: TrendingUp, tint: "from-[oklch(0.38_0.13_260)] to-[oklch(0.56_0.14_240)]" },
];

type Seed = { text: string; nonce: number };
type Upload = { jobId: string | null; name: string; pct: number; done: boolean };

function putWithProgress(url: string, method: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload was refused.")));
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.send(file);
  });
}

type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: SpeechResultEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };

function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A pill on the composer that opens a short list of choices. */
function ChipMenu<T extends string>({ title, icon: Icon, value, options, onChange, shown }: {
  title: string; icon: LucideIcon; value: T; options: readonly { id: T; label: string; hint?: string }[]; onChange: (id: T) => void; shown: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={shown === title ? title : `${title}: ${shown}`} className="inline-flex h-10 max-w-[9.5rem] shrink-0 items-center gap-1 rounded-full border border-border bg-white/70 px-2.5 text-xs font-medium hover:bg-white sm:h-8 sm:gap-1.5 sm:px-3">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{shown}</span>
          <ChevronDown className="hidden size-3 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 rounded-2xl bg-white p-1.5 shadow-xl">
        <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{title}</p>
        {options.map((option) => (
          <button key={option.id} type="button" onClick={() => { onChange(option.id); setOpen(false); }} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2.5 text-left text-sm hover:bg-secondary sm:min-h-9">
            <span className="min-w-0"><span className="block truncate">{option.label}</span>{option.hint ? <span className="block truncate text-xs text-muted-foreground">{option.hint}</span> : null}</span>
            {option.id === value ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PlusCard({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-white/70 p-2 text-center text-xs font-medium hover:bg-white">
      <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden="true" /></span>
      {label}
    </button>
  );
}

/**
 * Social media, centred on Co-work. It is the same agent and the same ongoing
 * conversation as Home and the Assistant page; this screen only adds a composer
 * shaped for posting and a running list of results.
 */
export function SocialCowork() {
  const qc = useQueryClient();
  const getHome = useServerFn(getAssistantHome);
  const getConversation = useServerFn(getAssistantConversation);
  const fetchSession = useServerFn(getSession);
  const startUpload = useServerFn(startVideoUpload);
  const finishUpload = useServerFn(finishVideoUpload);

  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const threadId = home.data?.ongoing.id;
  const conversation = useQuery({ queryKey: ["assistant-conversation", threadId], enabled: Boolean(threadId), queryFn: () => getConversation({ data: { threadId: threadId as string } }) });
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });

  const [chatting, setChatting] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform>("auto");
  const [format, setFormat] = useState<SocialFormat>("auto");
  const [style, setStyle] = useState<SocialStyle>("auto");
  const [seed, setSeed] = useState<Seed | undefined>();
  const [upload, setUpload] = useState<Upload | null>(null);
  const [listening, setListening] = useState(false);
  const [greeting, setGreeting] = useState("Hello");
  const [canSpeak, setCanSpeak] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
    setCanSpeak(Boolean(speechRecognition()));
    return () => recognition.current?.stop();
  }, []);

  const write = (text: string) => setSeed({ text, nonce: Date.now() });
  const firstName = session.data?.name?.trim().split(/\s+/)[0];

  const turns: OwnerAssistantTurn[] = useMemo(() => (conversation.data?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "you" : "assistant",
    text: message.text,
    ...(message.proposals.length ? { proposals: message.proposals as NonNullable<OwnerAssistantTurn["proposals"]> } : {}),
    ...(message.done ? { done: message.done } : {}),
  })), [conversation.data]);

  const surface: AssistantSurface = {
    area: "social", platform, format, style,
    ...(upload?.done && upload.jobId ? { videoId: upload.jobId } : {}),
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUpload({ jobId: null, name: file.name, pct: 0, done: false });
      const contentType = file.type.startsWith("video/") ? file.type : "video/mp4";
      const started = await startUpload({ data: { filename: file.name, contentType, sizeBytes: file.size } });
      setUpload({ jobId: started.jobId, name: file.name, pct: 0, done: false });
      try {
        await putWithProgress(started.url, started.method, started.headers, file, (pct) => setUpload((u) => (u ? { ...u, pct } : u)));
      } catch (error) {
        await finishUpload({ data: { jobId: started.jobId, failure: "The upload didn't finish." } }).catch(() => undefined);
        throw error;
      }
      const finished = await finishUpload({ data: { jobId: started.jobId } });
      if (finished.status === "FAILED") throw new Error("That video couldn't be prepared.");
      return started.jobId;
    },
    onSuccess: (jobId) => {
      setUpload((u) => (u ? { ...u, jobId, pct: 100, done: true } : u));
      write("Turn this video into short clips.");
      void qc.invalidateQueries({ queryKey: ["video-clips"] });
    },
    onError: (error) => {
      setUpload(null);
      toast.error(error instanceof Error ? error.message : "That video couldn't be uploaded.");
    },
  });

  function chooseVideo() { setPlusOpen(false); fileRef.current?.click(); }

  function toggleVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const Speech = speechRecognition();
    if (!Speech) return;
    const r = new Speech();
    r.lang = navigator.language || "en-AU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => write(Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>).map((x) => x[0]?.transcript ?? "").join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); toast.error("Couldn't hear that. Check the microphone is allowed."); };
    recognition.current = r;
    setListening(true);
    r.start();
  }

  function askFromResults(text: string) { setResultsOpen(false); write(text); }

  if (home.isError || conversation.isError) {
    return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Co-work couldn't be opened here. Refresh the page to try again.</div>;
  }
  if (!threadId || conversation.isLoading) {
    return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Opening Co-work" /></div>;
  }

  const starters = (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Start with one of these</p>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 cowork-scroll lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
        {STARTERS.map((s) => (
          <button key={s.title} type="button" onClick={() => (s.video ? chooseVideo() : write(s.prompt))} className={`flex h-32 w-40 shrink-0 snap-start flex-col justify-between rounded-2xl bg-gradient-to-br ${s.tint} p-3 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 lg:w-auto`}>
            <s.icon className="size-5" aria-hidden="true" />
            <span className="text-sm font-semibold leading-tight">{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const hero = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5 lg:flex-none lg:overflow-visible lg:pb-5 lg:pt-0">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="text-center">
          <p className="text-sm text-muted-foreground lg:text-base">{greeting}{firstName ? `, ${firstName}` : ""}</p>
          <h1 className="mt-1 text-balance font-heading text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl lg:text-[44px]">
            What should we <span className="cowork-accent">post</span> today?
          </h1>
          {turns.length > 0 ? (
            <button type="button" onClick={() => setChatting(true)} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10">
              <History className="size-3.5" aria-hidden="true" /> Carry on your conversation
            </button>
          ) : null}
        </div>
        <div className="space-y-5 lg:hidden">
          {starters}
          <SocialResults onAsk={askFromResults} />
          <DoItYourself />
        </div>
      </div>
    </div>
  );

  const tools: ReactNode = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto cowork-scroll">
      <Popover open={plusOpen} onOpenChange={setPlusOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Add something" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-white/70 hover:bg-white sm:size-8"><Plus className="size-4" aria-hidden="true" /></button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl bg-white p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <PlusCard icon={Film} label="Add a video" onClick={chooseVideo} />
            <PlusCard icon={Link2} label="Paste a video link" onClick={() => { setPlusOpen(false); write("Clip this video into shorts. I own it or have permission: "); }} />
            <PlusCard icon={PenLine} label="Write a post" onClick={() => { setPlusOpen(false); write("Write a post about "); }} />
            <PlusCard icon={MessageCircle} label="Answer comments" onClick={() => { setPlusOpen(false); write("Which comments and messages are waiting for a reply? Suggest what to say to each."); }} />
          </div>
        </PopoverContent>
      </Popover>
      {upload ? (
        <span className="inline-flex h-10 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-medium text-primary sm:h-8">
          {upload.done ? <Film className="size-3.5 shrink-0" aria-hidden="true" /> : <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
          <span className="truncate">{upload.done ? upload.name : `${upload.pct}%`}</span>
          {upload.done ? <button type="button" aria-label="Remove video" onClick={() => setUpload(null)} className="-mr-1 grid size-6 place-items-center rounded-full hover:bg-primary/10"><X className="size-3.5" aria-hidden="true" /></button> : null}
        </span>
      ) : null}
      <ChipMenu title="Post to" icon={Layers} value={platform} options={SOCIAL_PLATFORMS} onChange={setPlatform} shown={SOCIAL_PLATFORMS.find((p) => p.id === platform)?.label ?? "Best fit"} />
      <ChipMenu title="Format" icon={RectangleVertical} value={format} options={SOCIAL_FORMATS} onChange={setFormat} shown={format === "auto" ? "Format" : format} />
      <ChipMenu title="Style" icon={Wand2} value={style} options={SOCIAL_STYLES} onChange={setStyle} shown={style === "auto" ? "Style" : (SOCIAL_STYLES.find((s) => s.id === style)?.label ?? "Style")} />
      <input ref={fileRef} type="file" accept="video/*" aria-label="Choose a video" className="sr-only" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > MAX_VIDEO_BYTES) { toast.error("Videos can be up to 4 GB."); return; }
        uploadMutation.mutate(file);
      }} />
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
          label="Co-work"
          hideTurns={!chatting}
          hero={hero}
          surface={surface}
          seed={seed}
          placeholder="Ask for a post, drop in a video, or say what's on your mind…"
          composerClassName="cowork-ring relative z-20 mx-auto mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-2 w-[calc(100%-1.5rem)] max-w-3xl shrink-0 rounded-[1.25rem] sm:w-[calc(100%-2rem)]"
          composerTools={tools}
          belowComposer={<div className="mx-auto mt-4 hidden w-[calc(100%-2rem)] max-w-3xl lg:block">{starters}</div>}
          centerWhenEmpty
          emptyAction={canSpeak ? (
            <button type="button" onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Speak instead"} aria-pressed={listening} className={`grid size-10 shrink-0 place-items-center rounded-xl border sm:size-8 ${listening ? "animate-pulse border-primary bg-primary text-primary-foreground" : "border-border bg-white/70 hover:bg-white"}`}>
              <Mic className="size-4" aria-hidden="true" />
            </button>
          ) : undefined}
          onStart={() => setChatting(true)}
          onSent={() => setUpload((u) => (u?.done ? null : u))}
          onConversationChanged={() => { void qc.invalidateQueries({ queryKey: ["assistant-home"] }); void qc.invalidateQueries({ queryKey: ["video-clips"] }); }}
        />
      </div>

      <aside aria-label="Results" className="hidden h-full min-h-0 w-[22rem] shrink-0 overflow-y-auto border-l border-border/60 p-4 lg:block xl:w-96">
        <h2 className="mb-3 font-heading text-lg font-semibold">Results</h2>
        <div className="space-y-5">
          <SocialResults onAsk={askFromResults} />
          <DoItYourself />
        </div>
      </aside>

      <Drawer open={resultsOpen} onOpenChange={setResultsOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerTitle className="px-4 pt-3 font-heading text-lg">Results</DrawerTitle>
          <div className="space-y-5 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SocialResults onAsk={askFromResults} />
            <DoItYourself />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
