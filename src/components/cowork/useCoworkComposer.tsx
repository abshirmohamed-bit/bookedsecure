import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, FileUp, Film, Layers, Link2, Loader2, MessageCircle, Mic, PenLine, Plus, RectangleVertical, Wand2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hasSurfaceChoices, SOCIAL_FORMATS, SOCIAL_PLATFORMS, SOCIAL_STYLES, type AssistantSurface, type SocialFormat, type SocialPlatform, type SocialStyle } from "@/lib/social-cowork";
import { MAX_VIDEO_BYTES } from "@/lib/video-clips";
import { finishVideoUpload, startVideoUpload } from "@/lib/video-clips.functions";

type Upload = { jobId: string | null; name: string; pct: number; done: boolean };
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: SpeechResultEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };

function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
 * Everything on Co-Work's composer. Every page that shows Co-Work gets this same
 * set through OwnerAssistant, so nothing can be done in one place and not another.
 */
export function useCoworkComposer({ write, onImportCsv, extra }: { write: (text: string) => void; onImportCsv: () => void; extra?: ReactNode }) {
  const qc = useQueryClient();
  const startUpload = useServerFn(startVideoUpload);
  const finishUpload = useServerFn(finishVideoUpload);
  const [plusOpen, setPlusOpen] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform>("auto");
  const [format, setFormat] = useState<SocialFormat>("auto");
  const [style, setStyle] = useState<SocialStyle>("auto");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    setCanSpeak(Boolean(speechRecognition()));
    return () => recognition.current?.stop();
  }, []);

  const choices: AssistantSurface = { platform, format, style, ...(upload?.done && upload.jobId ? { videoId: upload.jobId } : {}) };

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
  function fromPlus(action: () => void) { setPlusOpen(false); action(); }

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

  const tools: ReactNode = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto cowork-scroll">
      <Popover open={plusOpen} onOpenChange={setPlusOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Add something" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-white/70 hover:bg-white sm:size-8"><Plus className="size-4" aria-hidden="true" /></button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl bg-white p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <PlusCard icon={Film} label="Add a video" onClick={chooseVideo} />
            <PlusCard icon={Link2} label="Paste a video link" onClick={() => fromPlus(() => write("Here's a video: "))} />
            <PlusCard icon={PenLine} label="Write a post" onClick={() => fromPlus(() => write("Write a post about "))} />
            <PlusCard icon={MessageCircle} label="Answer comments" onClick={() => fromPlus(() => write("Which comments and messages are waiting for a reply? Suggest what to say to each."))} />
            <PlusCard icon={FileUp} label="Import contacts (CSV)" onClick={() => fromPlus(onImportCsv)} />
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
      {extra}
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

  const emptyAction: ReactNode = canSpeak ? (
    <button type="button" onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Speak instead"} aria-pressed={listening} className={`grid size-10 shrink-0 place-items-center rounded-xl border sm:size-8 ${listening ? "animate-pulse border-primary bg-primary text-primary-foreground" : "border-border bg-white/70 hover:bg-white"}`}>
      <Mic className="size-4" aria-hidden="true" />
    </button>
  ) : null;

  return {
    tools,
    emptyAction,
    chooseVideo,
    surface: hasSurfaceChoices(choices) ? choices : undefined,
    clearAfterSend: () => setUpload((u) => (u?.done ? null : u)),
  };
}
