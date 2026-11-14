import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Captions, Check, ChevronRight, Crop, Download, Info, Loader2, Minus, Pencil, Plus, Scissors, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import type { Clip, Job } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { saveAssistantDraft } from "@/lib/assistant-draft";
import { LivePreview } from "@/components/studio/LivePreview";
import { CAPTION_POSITIONS, CAPTION_SIZE, type CaptionPosition, type ClipStyle, CLIP_LAYOUT_IDS, CLIP_ZOOM_IDS, type ClipLayout, type ClipZoom, groupCaptionLines, MAX_CLIP_MS, MIN_CLIP_MS, SHOT_KINDS, TITLE_POSITIONS, TITLE_STYLE_IDS, type TitlePosition, type TitleStyle, VIDEO_ASPECTS, type VideoAspect } from "@/lib/video-clips";
import { engineMakesClipVideo, finishBrowserClipVideo, getVideoClipEditor, getVideoClipPlan, renameVideoClip, renderVideoClip, saveVideoClipEdits } from "@/lib/video-clips.functions";
import { canRenderInBrowser, renderClipInBrowser } from "@/lib/clip-render";

type Tab = "details" | "captions" | "framing" | "trim";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "details", label: "Details", icon: Info },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "framing", label: "Framing", icon: Crop },
  { id: "trim", label: "Trim", icon: Scissors },
];
const RATIO: Record<VideoAspect, string> = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "4:5": "aspect-[4/5]", "16:9": "aspect-video" };
const isAspect = (v: unknown): v is VideoAspect => (VIDEO_ASPECTS as readonly unknown[]).includes(v);
const isLayout = (v: unknown): v is ClipLayout => (CLIP_LAYOUT_IDS as readonly unknown[]).includes(v);
const isZoom = (v: unknown): v is ClipZoom => (CLIP_ZOOM_IDS as readonly unknown[]).includes(v);
const isTitleStyle = (v: unknown): v is TitleStyle => (TITLE_STYLE_IDS as readonly unknown[]).includes(v);
const isTitlePosition = (v: unknown): v is TitlePosition => (TITLE_POSITIONS as readonly unknown[]).includes(v);

/** A close-enough look for each of the Engine's caption styles, for the swatches and the preview. */
const BASE = "font-black text-white [text-shadow:0_2px_0_rgb(0_0_0/0.85),0_0_6px_rgb(0_0_0/0.6)]";
const LOOKS: Record<string, { className: string; highlight?: boolean }> = {
  bold_white: { className: BASE },
  yellow_pop: { className: `${BASE} text-[#FFD60A]` },
  outlined: { className: BASE },
  boxed: { className: "rounded-md bg-black/70 px-2 py-0.5 font-bold text-white" },
  neon: { className: "font-black text-[#64D2FF] [text-shadow:0_0_8px_rgb(0_51_68)]" },
  minimal: { className: "font-semibold text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]" },
  karaoke_highlight: { className: BASE, highlight: true },
  word_pop: { className: BASE },
  two_color_speaker: { className: BASE, highlight: true },
  lower_third: { className: "rounded-md bg-black/60 px-2 py-0.5 font-bold text-white" },
  uppercase_impact: { className: `${BASE} uppercase` },
  handwritten: { className: "font-[cursive] font-normal text-white [text-shadow:0_2px_0_rgb(0_0_0/0.85)]" },
  bounce: { className: BASE },
  typewriter: { className: "font-mono font-bold text-white [text-shadow:0_2px_0_rgb(0_0_0/0.85)]" },
  glow_box: { className: "rounded-md bg-black/50 px-2 py-0.5 font-bold text-white" },
  highlighter: { className: "rounded-sm bg-[#FFD60A] px-1.5 font-bold text-black" },
  comic: { className: `${BASE} uppercase text-[#FFD60A]` },
  serif_quote: { className: "font-serif font-semibold text-white [text-shadow:0_2px_0_rgb(0_0_0/0.85)]" },
  clean_caps: { className: "font-bold uppercase tracking-wide text-white [text-shadow:0_2px_2px_rgb(0_0_0/0.6)]" },
  podcast_bar: { className: "rounded-md bg-black/75 px-2 py-0.5 font-bold text-white" },
};
const look = (id: string) => LOOKS[id] ?? { className: BASE };
/** One colour per kind of shot, for the framing strip. */
const KIND_COLOUR: Record<string, string> = {
  fill: "bg-primary", fit: "bg-[oklch(0.72_0.12_200)]", bars: "bg-slate-500", headline: "bg-slate-600",
  split: "bg-[oklch(0.7_0.15_150)]", grid: "bg-[oklch(0.65_0.15_120)]", screen: "bg-[oklch(0.7_0.14_60)]", pip: "bg-[oklch(0.7_0.16_320)]", feed: "bg-[oklch(0.65_0.12_250)]",
};

const clock = (ms: number, tenths = false) => {
  const total = Math.max(0, ms) / 1000;
  const s = Math.floor(total);
  const base = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((total - s) * 10)}` : base;
};

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

function Chips<T extends string>({ options, value, onChange, label, cols = 3 }: { options: readonly { id: T; name: string; hint?: string | null }[]; value: T; onChange: (v: T) => void; label: string; cols?: number }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-1 rounded-xl bg-white/50 p-1 ${cols === 4 ? "grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.hint ?? undefined} onClick={() => onChange(o.id)} className={`min-h-9 rounded-lg px-1 text-xs font-medium ${value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{o.name}</button>
      ))}
    </div>
  );
}

/**
 * Studio's clip editor. Title, Ask Co-Work, posting and downloading work on
 * their own; everything the Engine can do to the picture is read from the
 * clip's project and the Engine's catalog, previewed on request, and saved
 * back, which makes the video again.
 */
export function ClipEditor({ clip, job, onClose }: { clip: Clip; job: Job; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const renameFn = useServerFn(renameVideoClip);
  const renderFn = useServerFn(renderVideoClip);
  const editorFn = useServerFn(getVideoClipEditor);
  const planFn = useServerFn(getVideoClipPlan);
  const saveFn = useServerFn(saveVideoClipEdits);
  const finishFn = useServerFn(finishBrowserClipVideo);
  const fallbackFn = useServerFn(engineMakesClipVideo);
  // Making the video here: progress 0..1 while it renders, null otherwise.
  const [makingHere, setMakingHere] = useState<number | null>(null);
  const [canHere, setCanHere] = useState(false);
  useEffect(() => setCanHere(canRenderInBrowser()), []);
  const busyHere = makingHere !== null;
  useEffect(() => {
    if (!busyHere) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busyHere]);
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState(clip.title ?? "");
  useEffect(() => setTitle(clip.title ?? ""), [clip.id, clip.title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reading the project wakes the Engine, so only once an editing tab is opened
  // (or the headline group needs it on Details).
  const [wantEditor, setWantEditor] = useState(true);
  const editor = useQuery({
    queryKey: ["video-clip-editor", clip.id],
    queryFn: () => editorFn({ data: { clipId: clip.id } }),
    enabled: wantEditor,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const settings = editor.data?.settings;
  const catalog = editor.data?.catalog;

  // Edits, reset to what the Engine has whenever it answers again (after a save, say).
  const [styleId, setStyleId] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState<boolean | null>(null);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition | null | undefined>(undefined);
  const [captionSize, setCaptionSize] = useState<number | null>(null);
  /** A caption dragged on the video: 0 top .. 1 bottom; null = back to the preset; undefined = unchanged. */
  const [captionY, setCaptionY] = useState<number | null | undefined>(undefined);
  /** While a trim handle is dragged, the moment the preview shows. */
  const [scrub, setScrub] = useState<number | null>(null);
  /** The preview's playhead, read by the timeline on its own frame loop. */
  const timeRef = useRef(0);
  const [layout, setLayout] = useState<ClipLayout | null>(null);
  const [zoom, setZoom] = useState<ClipZoom | null>(null);
  const [aspect, setAspect] = useState<VideoAspect | null>(null);
  const [headline, setHeadline] = useState<{ text?: string; enabled?: boolean; style?: TitleStyle; position?: TitlePosition }>({});
  const [lineTexts, setLineTexts] = useState<Record<number, string>>({});
  // Live preview of the edits, or the video as it was last made.
  const [showMade, setShowMade] = useState(false);
  useEffect(() => {
    setStyleId(null); setCaptionsOn(null); setCaptionPosition(undefined); setCaptionSize(null); setCaptionY(undefined); setLayout(null); setZoom(null); setAspect(null); setHeadline({}); setLineTexts({});
  }, [editor.dataUpdatedAt]);

  const baseStart = settings?.inMs ?? clip.start_ms ?? 0;
  const baseEnd = settings?.outMs ?? clip.end_ms ?? baseStart + (clip.duration_ms ?? 0);
  const [range, setRange] = useState<{ in: number; out: number } | null>(null);
  useEffect(() => setRange(null), [clip.id, baseStart, baseEnd]);
  const start = range?.in ?? baseStart;
  const end = range?.out ?? baseEnd;

  const current = {
    styleId: styleId ?? settings?.styleId ?? "bold_white",
    captionsOn: captionsOn ?? settings?.captionsOn ?? true,
    captionPosition: captionPosition !== undefined ? captionPosition : (settings?.captionPosition ?? null),
    captionSize: captionSize ?? settings?.captionSize ?? 1,
    captionY: captionY !== undefined ? captionY : (settings?.captionY ?? null),
    layout: layout ?? (isLayout(settings?.layout) ? settings.layout : "auto"),
    zoom: zoom ?? (isZoom(settings?.zoom) ? settings.zoom : "auto"),
    aspect: aspect ?? (isAspect(settings?.aspect) ? settings.aspect : isAspect(job.aspect) ? job.aspect : "9:16"),
    headlineText: headline.text ?? settings?.headline.text ?? "",
    headlineEnabled: headline.enabled ?? settings?.headline.enabled ?? true,
    headlineStyle: headline.style ?? (isTitleStyle(settings?.headline.style) ? settings.headline.style : "bold_band"),
    headlinePosition: headline.position ?? (isTitlePosition(settings?.headline.position) ? settings.headline.position : "auto"),
  };
  const lines = useMemo(() => groupCaptionLines(editor.data?.words ?? []), [editor.data?.words]);
  const lineEdits = lines.filter((l) => lineTexts[l.start_ms] !== undefined && lineTexts[l.start_ms]!.replace(/\s+/g, " ").trim() !== l.text)
    .map((l) => ({ start_ms: l.start_ms, from: l.text, to: lineTexts[l.start_ms]! }));
  const trimmed = start !== baseStart || end !== baseEnd;

  const changes: string[] = [];
  const edits: Record<string, unknown> = {};
  if (settings) {
    if (current.styleId !== settings.styleId) { changes.push("caption style"); edits["styleId"] = current.styleId; }
    if (current.captionsOn !== settings.captionsOn) { changes.push(current.captionsOn ? "captions on" : "captions off"); edits["captionsOn"] = current.captionsOn; }
    if (current.captionPosition !== settings.captionPosition) { changes.push("caption position"); edits["captionPosition"] = current.captionPosition; }
    if (Math.abs(current.captionSize - settings.captionSize) > 0.01) { changes.push("caption size"); edits["captionSize"] = current.captionSize; }
    if (current.captionY !== settings.captionY) { if (!changes.includes("caption position")) changes.push("caption position"); edits["captionY"] = current.captionY; }
    if (lineEdits.length) changes.push(`${lineEdits.length} caption line${lineEdits.length === 1 ? "" : "s"}`);
    if (current.layout !== settings.layout) { changes.push("layout"); edits["layout"] = current.layout; }
    if (current.zoom !== settings.zoom) { changes.push("zoom"); edits["zoom"] = current.zoom; }
    if (current.aspect !== settings.aspect) { changes.push("shape"); edits["aspect"] = current.aspect; }
    if (current.headlineText.trim() !== settings.headline.text.trim()) { changes.push("headline"); edits["headlineText"] = current.headlineText; }
    if (current.headlineEnabled !== settings.headline.enabled) { changes.push(current.headlineEnabled ? "headline on" : "headline off"); edits["headlineEnabled"] = current.headlineEnabled; }
    if (current.headlineStyle !== settings.headline.style) { changes.push("headline style"); edits["headlineStyle"] = current.headlineStyle; }
    if (current.headlinePosition !== settings.headline.position) { changes.push("headline position"); edits["headlinePosition"] = current.headlinePosition; }
  }
  if (trimmed) { changes.push("trim"); edits["inMs"] = start; edits["outMs"] = end; }

  // How the Engine will cut this clip, for the choices being tried. Lazy: it
  // can take a while the first time a clip is analysed.
  const planKey = (layoutId: ClipLayout) => ["video-clip-plan", clip.id, layoutId, current.zoom, current.aspect] as const;
  const plan = useQuery({
    queryKey: planKey(current.layout),
    queryFn: () => planFn({ data: { clipId: clip.id, layout: current.layout, zoom: current.zoom, aspect: current.aspect } }),
    enabled: Boolean(settings),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    // keep showing the last plan while another layout's is read, so nothing flashes
    placeholderData: (previous) => previous,
  });
  const planReady = (layoutId: ClipLayout) => ["streamer", "black-box", "title-subtitles"].includes(layoutId) || Boolean(qc.getQueryData(planKey(layoutId)));
  // Read every other layout's plan in the background (one at a time; the clip's
  // analysis is cached on the Engine), so switching layouts is instant.
  const firstPlan = Boolean(plan.data) && !plan.isPlaceholderData;
  // Each background read bumps this so the chips redraw: reading the cache alone
  // doesn't, and their "still reading" dots used to pulse forever.
  const [, setPlansRead] = useState(0);
  useEffect(() => {
    if (!firstPlan || !catalog) return;
    let cancelled = false;
    void (async () => {
      for (const l of catalog.layouts) {
        if (cancelled) return;
        if (!isLayout(l.id) || ["streamer", "black-box", "title-subtitles"].includes(l.id)) continue;
        await qc.prefetchQuery({
          queryKey: planKey(l.id), staleTime: 10 * 60_000,
          queryFn: () => planFn({ data: { clipId: clip.id, layout: l.id, zoom: current.zoom, aspect: current.aspect } }),
        }).catch(() => undefined);
        if (!cancelled) setPlansRead((n) => n + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [firstPlan, catalog, current.zoom, current.aspect, clip.id]);

  const rename = useMutation({
    mutationFn: () => renameFn({ data: { clipId: clip.id, title } }),
    onSuccess: async (r) => { setTitle(r.title); await qc.invalidateQueries({ queryKey: ["video-clips"] }); toast.success("Title saved."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That title couldn't be saved."),
  });
  const render = useMutation({
    mutationFn: () => renderFn({ data: { clipId: clip.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-clips"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That clip couldn't be made."),
  });
  const here = canHere && Boolean(editor.data?.browserUploads) && Boolean(settings?.sourceUrl);
  const save = useMutation({
    mutationFn: async (): Promise<{ where: "browser" | "engine"; reason?: string }> => {
      const r = await saveFn({ data: { clipId: clip.id, ...edits, ...(lineEdits.length ? { lineEdits } : {}), ...(here ? { browser: true } : {}) } });
      if (!r.render) return { where: "engine" };
      const saved = r.render.settings;
      try {
        setMakingHere(0);
        if (!saved.sourceUrl) throw new Error("The clip's source video isn't available.");
        const styleDefault = catalog?.captionStyles.find((x) => x.id === saved.styleId)?.defaults.position ?? "middle";
        const out = await renderClipInBrowser({
          src: saved.sourceUrl, offsetMs: saved.sourceOffsetMs, startMs: saved.inMs, endMs: saved.outMs,
          aspect: isAspect(saved.aspect) ? saved.aspect : "9:16",
          plan: plan.data ? { source: plan.data.source, shots: plan.data.shots, active: plan.data.active ?? null } : null, planStartMs: baseStart,
          words: r.render.words,
          captions: { on: saved.captionsOn, styleId: saved.styleId, position: saved.captionPosition ?? styleDefault, size: saved.captionSize, y: saved.captionY },
          headline: { on: saved.headline.enabled, text: saved.headline.text, position: saved.headline.position },
        }, setMakingHere);
        const put = await fetch(r.render.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: out.blob });
        if (!put.ok) throw new Error(`The upload was refused (${put.status}).`);
        await finishFn({ data: { clipId: clip.id, key: r.render.key, width: out.width, height: out.height, durationMs: out.durationMs } });
        return { where: "browser" };
      } catch (error) {
        await fallbackFn({ data: { clipId: clip.id } }).catch(() => undefined);
        return { where: "engine", reason: error instanceof Error ? error.message : String(error) };
      } finally {
        setMakingHere(null);
      }
    },
    onSuccess: async (r) => {
      if (r.where === "browser") toast.success("Saved, and the new video is ready.");
      else toast.success(r.reason ? `Saved. This browser couldn't make the video (${r.reason}), so the Engine is making it; it takes a minute or two.` : "Saved. Making the video again; it takes a minute or two.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["video-clips"] }), qc.invalidateQueries({ queryKey: ["video-clip-editor", clip.id] })]);
    },
    onError: async (e) => {
      toast.error(e instanceof Error ? e.message : "Those changes couldn't be saved.");
      await qc.invalidateQueries({ queryKey: ["video-clips"] });
    },
  });
  const askCowork = (text: string) => { saveAssistantDraft(text); void navigate({ to: "/assistant" }); };

  const ready = clip.status === "READY" && Boolean(clip.video_url);
  const making = clip.status === "EXPORTING";
  const name = title.trim() || "Clip";
  const saved = (clip.title ?? "") === title.trim();
  const styleDef = catalog?.captionStyles.find((s) => s.id === current.styleId);
  const stylePosition = current.captionPosition ?? styleDef?.defaults.position ?? "middle";
  const sampleLine = lines.find((l) => l.text)?.text ?? "This is how it looks";
  const source = settings?.trimTo ?? job.duration_ms ?? null;
  const live = Boolean(settings?.sourceUrl) && !(showMade && ready);
  const shownVideo = ready ? clip.video_url : null;

  return (
    <Portal>
      <div role="dialog" aria-modal="true" aria-label={`Edit ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-[var(--canvas)] [background-image:var(--canvas-gradient)]">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 sm:px-5">
          <Button variant="ghost" size="sm" className="min-h-10 shrink-0" onClick={onClose}><ArrowLeft className="size-4" aria-hidden="true" />Library</Button>
          {/* the post title, edited in place: click it, type, Enter or tick to save */}
          <form className="group/title flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (!saved && title.trim()) rename.mutate(); }}>
            <div className="min-w-0 flex-1">
              <input aria-label="Clip title (used when you post)" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)}
                className="w-full truncate rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none transition hover:border-border hover:bg-white/50 focus:border-primary/50 focus:bg-white/80" />
              <p className="truncate px-1.5 text-[11px] text-muted-foreground">{job.source_name}</p>
            </div>
            {!saved && title.trim() ? (
              <Button type="submit" size="icon" variant="outline" className="size-9 shrink-0 animate-in zoom-in-50" disabled={rename.isPending} aria-label="Save title">
                {rename.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              </Button>
            ) : <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover/title:opacity-100" aria-hidden="true" />}
          </form>
          <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${ready ? "bg-emerald-500/15 text-emerald-700" : making ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {ready ? "Ready" : making ? "Making…" : clip.status === "FAILED" ? "Failed" : "Not made yet"}
          </span>
          {ready ? (
            <>
              <Button asChild variant="outline" size="sm" className="hidden min-h-10 sm:inline-flex"><a href={clip.video_url ?? undefined} download><Download className="size-4" aria-hidden="true" />Download</a></Button>
              <Button asChild size="sm" className="btn-glow min-h-10"><Link to="/social" search={{ platform: "youtube", clip: clip.id, clipTitle: name.slice(0, 100) }}><Send className="size-4" aria-hidden="true" />Post</Link></Button>
            </>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* Preview, quick controls and timeline */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 p-3 lg:overflow-y-auto lg:p-5">
            <div className={`relative w-full max-w-[min(22rem,100%)] overflow-hidden rounded-3xl bg-black shadow-xl ring-1 ring-white/40 transition-[aspect-ratio,max-width] duration-300 ${RATIO[current.aspect]} ${current.aspect === "16:9" ? "max-w-[min(40rem,100%)]" : current.aspect === "9:16" ? "lg:max-w-[min(22rem,calc((100dvh-17rem)*9/16))]" : ""}`}>
              {live && settings?.sourceUrl ? (
                <LivePreview
                  src={settings.sourceUrl} offsetMs={settings.sourceOffsetMs} start={start} end={end} clipStart={baseStart}
                  aspect={current.aspect} layout={current.layout} plan={plan.data ?? null} lines={lines} lineTexts={lineTexts}
                  captions={{ on: current.captionsOn, className: look(current.styleId).className, highlight: Boolean(look(current.styleId).highlight), position: stylePosition, size: current.captionSize, y: current.captionY }}
                  headline={{ on: current.headlineEnabled, text: current.headlineText, position: current.headlinePosition }}
                  poster={clip.thumbnail_url ?? undefined} scrubMs={scrub} timeRef={timeRef}
                  onCaptionY={(y) => { setCaptionY(y); if (tab !== "captions") setTab("captions"); }}
                />
              ) : shownVideo ? (
                <video key={shownVideo} src={shownVideo} controls playsInline poster={clip.thumbnail_url ?? undefined} className="size-full object-contain" />
              ) : clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
              {!live && !ready ? (
                <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/60 p-2.5 text-center text-xs text-white">
                  {making ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Making the video…</span> : clip.status === "FAILED" ? (clip.error ?? "This clip couldn't be made.") : settings ? "Not made into a video yet." : <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Loading the clip…</span>}
                </div>
              ) : null}
            </div>

            {/* one tap for the main choices, without leaving the video */}
            {settings ? (
              <div className="glass flex w-full max-w-2xl flex-wrap items-center justify-center gap-1.5 rounded-2xl p-1.5">
                {settings.sourceUrl && ready ? (
                  <Seg value={showMade ? "made" : "live"} onChange={(v) => setShowMade(v === "made")} label="What the preview shows"
                    options={[{ id: "live", name: "Live" }, { id: "made", name: "Made" }]} />
                ) : null}
                <QuickToggle on={current.captionsOn} onChange={setCaptionsOn} icon={Captions} label="Captions" />
                <Seg value={current.captionY !== null ? "free" : stylePosition} label="Caption position"
                  onChange={(v) => { if (v !== "free") { setCaptionPosition(v as CaptionPosition); setCaptionY(null); } }}
                  options={[{ id: "top", name: "Top" }, { id: "middle", name: "Mid" }, { id: "lower", name: "Low" }, ...(current.captionY !== null ? [{ id: "free", name: `${Math.round(current.captionY * 100)}%` }] : [])]} />
                <Seg value={current.aspect} onChange={(v) => setAspect(v as VideoAspect)} label="Shape" options={VIDEO_ASPECTS.map((a) => ({ id: a, name: a }))} />
              </div>
            ) : null}
            {settings && catalog ? (
              <div className="flex w-full max-w-2xl gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Layout">
                {catalog.layouts.filter((l) => isLayout(l.id)).map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={current.layout === l.id} title={l.hint ?? undefined}
                    onClick={() => setLayout(l.id as ClipLayout)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition hover:-translate-y-0.5 active:scale-95 ${current.layout === l.id ? "border-primary bg-primary text-primary-foreground shadow-md" : "border-white/70 bg-white/60 text-foreground/80 hover:bg-white"}`}>
                    {l.name}{planReady(l.id as ClipLayout) ? null : <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current opacity-50 align-middle" aria-label="Reading" />}
                  </button>
                ))}
              </div>
            ) : null}
            {settings?.style ? <StyleNote style={settings.style} layout={current.layout} onUse={(l) => setLayout(l)} /> : null}

            <Timeline start={start} end={end} baseStart={clip.start_ms ?? baseStart} baseEnd={clip.end_ms ?? baseEnd} source={source}
              clipStart={baseStart} words={editor.data?.words ?? []} shots={plan.data?.shots ?? []} timeRef={timeRef}
              onScrub={setScrub}
              onChange={(r) => { setRange(r); if (tab !== "trim") setTab("trim"); }} />
          </div>

          {/* Tools */}
          <aside className="flex w-full shrink-0 flex-col border-t border-border/60 bg-white/20 lg:w-[24rem] lg:border-l lg:border-t-0">
            <nav aria-label="Editor tools" className="flex shrink-0 gap-1 border-b border-border/60 p-1.5">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={`relative inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-medium transition active:scale-95 ${tab === t.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-white/70 hover:text-foreground"}`}>
                  <t.icon className="size-4" aria-hidden="true" />{t.label}
                  {t.id === "trim" && trimmed ? <span className="absolute right-1.5 top-1.5 size-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden="true" /> : null}
                </button>
              ))}
            </nav>

            <div key={tab} className="min-h-0 flex-1 space-y-4 p-3 animate-in fade-in slide-in-from-right-2 duration-200 lg:overflow-y-auto">
              {tab === "details" ? (
                <>
                  <Group title="Headline on the video" action={settings ? <Switch on={current.headlineEnabled} onChange={(v) => setHeadline((h) => ({ ...h, enabled: v }))} label="Show the headline on the video" /> : null}>
                    {!settings ? (
                      <button type="button" onClick={() => setWantEditor(true)} className="glass flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-sm hover:bg-white/70">
                        <span>Edit the headline, style and position</span>{editor.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                      </button>
                    ) : current.headlineEnabled ? (
                      <>
                        <input aria-label="Headline on the video" value={current.headlineText} maxLength={120} onChange={(e) => setHeadline((h) => ({ ...h, text: e.target.value }))} placeholder="A line that makes someone stop" className="min-h-9 w-full rounded-xl border border-input bg-white/70 px-3 text-base outline-none transition focus:ring-2 focus:ring-primary/40 sm:text-sm" />
                        {catalog ? <Chips options={catalog.titleStyles.filter((t) => isTitleStyle(t.id)) as { id: TitleStyle; name: string; hint?: string | null }[]} value={current.headlineStyle} onChange={(v) => setHeadline((h) => ({ ...h, style: v }))} label="Headline style" cols={4} /> : null}
                        <Chips options={[{ id: "auto", name: "Auto", hint: "Top, unless the head is up there" }, { id: "top", name: "Top" }, { id: "bottom", name: "Bottom" }] as const} value={current.headlinePosition} onChange={(v) => setHeadline((h) => ({ ...h, position: v }))} label="Headline position" />
                      </>
                    ) : <p className="text-xs text-muted-foreground">No headline on the video.</p>}
                  </Group>
                  {clip.reason ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5">
                      <p className="text-[11px] font-semibold text-primary">Why Co-Work picked it</p>
                      <p className="mt-0.5 text-[13px] leading-snug">{clip.reason}</p>
                    </div>
                  ) : null}
                  <Group title="Ask Co-Work">
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        ["Write a caption", `Write a caption for the clip called "${name.slice(0, 120)}".`],
                        ["Better title", `Suggest three punchier titles for the clip called "${name.slice(0, 120)}".`],
                        ["How is it framed?", `Explain how the clip called "${name.slice(0, 120)}" is framed, shot by shot, and whether a different layout would suit it better.`],
                        ["Where to post?", `Which channel and time should I post the clip called "${name.slice(0, 120)}" on, and why?`],
                      ].map(([label, prompt]) => (
                        <button key={label} type="button" onClick={() => askCowork(prompt as string)} className="glass flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-left text-[12px] transition hover:-translate-y-0.5 hover:bg-white/80 active:scale-95">
                          <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" />{label}
                        </button>
                      ))}
                    </div>
                  </Group>
                  {!ready && (clip.status === "FOUND" || clip.status === "FAILED") ? (
                    <Button className="min-h-10 w-full" disabled={render.isPending} onClick={() => render.mutate()}>{render.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{clip.status === "FAILED" ? "Try again" : "Make video"}</Button>
                  ) : null}
                </>
              ) : !settings ? (
                <div className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  {editor.isError ? (
                    <>
                      <p>{editor.error instanceof Error ? editor.error.message : "The clip's settings couldn't be loaded."}</p>
                      <Button variant="outline" className="min-h-10" onClick={() => void editor.refetch()}>Try again</Button>
                    </>
                  ) : <><Loader2 className="size-5 animate-spin" aria-hidden="true" /><p>Waking the Engine and loading the clip's settings…</p></>}
                </div>
              ) : null}

              {tab === "captions" && settings && catalog ? (
                <>
                  <Group title="Captions" action={<Switch on={current.captionsOn} onChange={setCaptionsOn} label="Show captions" />}>
                    <p className="text-[11px] text-muted-foreground">{current.captionsOn ? "Drag the words on the video to place them anywhere." : "No words on the video."}</p>
                  </Group>
                  {current.captionsOn ? (
                    <>
                      <Group title="Style">
                        <div className="grid grid-cols-4 gap-1">
                          {catalog.captionStyles.map((s) => (
                            <button key={s.id} type="button" onClick={() => setStyleId(s.id)} aria-pressed={current.styleId === s.id} title={s.name}
                              className={`grid min-h-8 place-items-center overflow-hidden rounded-lg bg-[oklch(0.3_0.05_258)] px-1 text-[9px] leading-tight ring-primary transition hover:scale-105 active:scale-95 ${current.styleId === s.id ? "ring-2 ring-offset-1" : "hover:ring-1"}`}>
                              <span className={`${look(s.id).className} truncate`}>{s.name}</span>
                            </button>
                          ))}
                        </div>
                      </Group>
                      <Group title="Position" action={current.captionY !== null ? <button type="button" className="text-[11px] text-primary" onClick={() => setCaptionY(null)}>Back to {stylePosition}</button> : null}>
                        <Chips options={[{ id: "style", name: "Style's own", hint: `This style puts the words ${styleDef?.defaults.position === "lower" ? "low" : styleDef?.defaults.position === "top" ? "high" : "in the middle"}` }, ...catalog.captionPositions.filter((p) => (CAPTION_POSITIONS as readonly string[]).includes(p.id))]}
                          value={current.captionY !== null ? ("free" as string) : (current.captionPosition ?? "style")}
                          onChange={(v) => { setCaptionPosition(v === "style" ? null : (v as CaptionPosition)); setCaptionY(null); }} label="Caption position" cols={4} />
                        {current.captionY !== null ? <p className="text-[11px] text-muted-foreground">Placed by hand at {Math.round(current.captionY * 100)}% from the top.</p> : null}
                      </Group>
                      <Group title={`Size · ${Math.round(current.captionSize * 100)}%`}>
                        <input type="range" min={catalog.captionSize.min} max={catalog.captionSize.max} step={CAPTION_SIZE.step} value={current.captionSize} onChange={(e) => setCaptionSize(Number(e.target.value))} aria-label="Caption size" className="w-full accent-[var(--color-primary)]" />
                      </Group>
                      <details className="group/words rounded-xl border border-white/70 bg-white/40">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
                          <span className="inline-flex items-center gap-1.5"><ChevronRight className="size-3.5 transition group-open/words:rotate-90" aria-hidden="true" />Fix words · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
                          {lineEdits.length ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{lineEdits.length} fixed</span> : null}
                        </summary>
                        <div className="space-y-1.5 px-2 pb-2">
                          {lines.length ? (
                            <ol className="max-h-[18rem] space-y-1 overflow-y-auto pr-1">
                              {lines.map((l) => (
                                <li key={l.start_ms} className="flex items-center gap-1.5">
                                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{clock(l.start_ms)}</span>
                                  <input aria-label={`Caption at ${clock(l.start_ms)}`} value={lineTexts[l.start_ms] ?? l.text} maxLength={400}
                                    onChange={(e) => setLineTexts((t) => ({ ...t, [l.start_ms]: e.target.value }))}
                                    className={`min-h-8 min-w-0 flex-1 rounded-lg border bg-white/70 px-2 text-base outline-none transition focus:ring-2 focus:ring-primary/40 sm:text-[13px] ${lineTexts[l.start_ms] !== undefined && lineTexts[l.start_ms] !== l.text ? "border-primary" : "border-input"}`} />
                                </li>
                              ))}
                            </ol>
                          ) : <p className="px-1 text-sm text-muted-foreground">No words were heard in this clip.</p>}
                          <div className="flex items-center justify-between px-1">
                            <p className="text-[10px] text-muted-foreground">Clear a line to drop it.</p>
                            {lineEdits.length ? <button type="button" className="text-[11px] text-primary" onClick={() => setLineTexts({})}>Undo fixes</button> : null}
                          </div>
                        </div>
                      </details>
                    </>
                  ) : null}
                </>
              ) : null}

              {tab === "framing" && settings && catalog ? (
                <>
                  <Group title="Layout">
                    <div className="grid grid-cols-2 gap-1.5">
                      {catalog.layouts.filter((l) => isLayout(l.id)).map((l) => (
                        <button key={l.id} type="button" onClick={() => setLayout(l.id as ClipLayout)} aria-pressed={current.layout === l.id} title={l.hint ?? undefined}
                          className={`flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-left transition hover:-translate-y-0.5 active:scale-95 ${current.layout === l.id ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-white/50 hover:bg-white/80"}`}>
                          <span className="text-[12px] font-semibold leading-tight">{l.name}</span>
                          {l.hint ? <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{l.hint}</span> : null}
                          {l.needs ? <span className="text-[9px] font-medium text-amber-700">needs {l.needs}</span> : null}
                        </button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Zoom">
                    <Chips options={catalog.zoom.filter((z) => isZoom(z.id)).map((z) => ({ id: z.id as ClipZoom, name: z.name, hint: z.hint ?? null }))} value={current.zoom} onChange={setZoom} label="Zoom" cols={3} />
                  </Group>
                  <Group title="How the Engine will cut it" action={plan.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}>
                    {plan.data ? (
                      <>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
                          {plan.data.shots.map((s, i) => {
                            const total = Math.max(1, plan.data!.shots[plan.data!.shots.length - 1]!.end_ms);
                            return <span key={i} title={SHOT_KINDS[s.kind] ?? s.kind} className={`${KIND_COLOUR[s.kind] ?? "bg-primary"} ${i ? "border-l border-white/70" : ""}`} style={{ width: `${((s.end_ms - s.start_ms) / total) * 100}%` }} />;
                          })}
                        </div>
                        <details className="group/shots">
                          <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">
                            {plan.data.shots.length} shots · {plan.data.people} {plan.data.people === 1 ? "person" : "people"} · {plan.data.cuts.length} camera cut{plan.data.cuts.length === 1 ? "" : "s"} <span className="text-primary group-open/shots:hidden">Show</span>
                          </summary>
                          <ol className="mt-1 max-h-48 space-y-1 overflow-y-auto text-[11px]">
                            {plan.data.shots.map((s, i) => (
                              <li key={i} className="flex gap-2">
                                <span className={`mt-1 size-2 shrink-0 rounded-full ${KIND_COLOUR[s.kind] ?? "bg-primary"}`} aria-hidden="true" />
                                <span className="w-[5rem] shrink-0 tabular-nums text-muted-foreground">{clock(s.start_ms)}–{clock(s.end_ms)}</span>
                                <span className="min-w-0"><span className="font-medium">{SHOT_KINDS[s.kind] ?? s.kind}{s.zoom > 1.01 ? ` · ${s.zoom.toFixed(2)}×` : ""}</span>{s.why ? <span className="text-muted-foreground"> — {s.why}</span> : null}</span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      </>
                    ) : plan.isError ? <p className="text-xs text-destructive">{plan.error instanceof Error ? plan.error.message : "The Engine couldn't read this clip."}</p>
                      : <p className="text-xs text-muted-foreground">Reading the clip's faces, voices and cuts…</p>}
                  </Group>
                </>
              ) : null}

              {tab === "trim" && settings ? (
                <Group title="Start and end">
                  <div className="grid grid-cols-2 gap-2">
                    {([["Starts at", "in"], ["Ends at", "out"]] as const).map(([label, edge]) => {
                      const value = edge === "in" ? start : end;
                      const nudge = (delta: number) => setRange(clampRange(edge, value + delta, start, end, source));
                      return (
                        <div key={edge} className="rounded-xl bg-white/50 p-2 text-[11px] text-muted-foreground">{label}
                          <div className="mt-1 flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" className="size-9 shrink-0 active:scale-90" aria-label={`${label} one second earlier`} onClick={() => nudge(-1000)}><Minus className="size-4" aria-hidden="true" /></Button>
                            <span className="min-w-0 flex-1 text-center text-sm font-semibold tabular-nums text-foreground">{clock(value, true)}</span>
                            <Button type="button" variant="outline" size="icon" className="size-9 shrink-0 active:scale-90" aria-label={`${label} one second later`} onClick={() => nudge(1000)}><Plus className="size-4" aria-hidden="true" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Drag the handles on the timeline: the video jumps to the edge you're moving. {clock(end - start)} long.</p>
                  {trimmed ? <button type="button" className="text-xs text-primary" onClick={() => setRange(null)}>Undo trim</button> : null}
                </Group>
              ) : null}
            </div>

            {tab !== "details" || (settings && changes.length) ? (
              <div className="shrink-0 border-t border-border/60 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                <Button className={`min-h-11 w-full transition ${changes.length && !save.isPending && !making ? "btn-glow" : ""}`} disabled={!changes.length || save.isPending || making || !settings} onClick={() => save.mutate()}>
                  {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{makingHere !== null ? `Making the video… ${Math.round(makingHere * 100)}%` : changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"} and make video` : "Save and make video"}
                </Button>
                {makingHere !== null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-valuenow={Math.round(makingHere * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, makingHere * 100)}%` }} />
                  </div>
                ) : null}
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {makingHere !== null ? "Making it here in your browser, faster than the clip plays. Keep this tab open until it's done." : making ? "The video is being made. You can save more changes once it's finished." : changes.length ? `Changing ${changes.join(", ")}.` : "Make a change to save it."}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </Portal>
  );
}

/** A small segmented control for the quick bar. */
/**
 * What the Engine made of this clip after cutting it: what it shows, the look
 * it gave it and why, and any note (a look the owner asked for that can't
 * apply to much of it), with the suggested look one tap away.
 */
function StyleNote({ style, layout, onUse }: { style: ClipStyle; layout: string; onUse: (l: ClipLayout) => void }) {
  const offer = style.suggested !== layout && !style.stale && isLayout(style.suggested) ? style.suggested : null;
  return (
    <div className="w-full max-w-2xl rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-[11px] leading-snug text-foreground/80">
      <p className="flex items-start gap-1.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          <span className="font-semibold text-foreground">{style.vibeLabel || "This clip"}</span>
          {style.stale ? " — edited since the Engine looked at it." : style.layout === layout
            ? <> — {style.name}{style.pickedBy === "owner" ? " (your choice)" : style.pickedBy === "learned" ? " (your usual look for clips like this)" : ""}{style.why ? `: ${style.why}` : ""}{style.fit < 0.99 ? ` (${Math.round(style.fit * 100)}% of the clip)` : ""}.</>
            : <> — the Engine suggests {style.suggestedName}.</>}
        </span>
      </p>
      {style.note && style.layout === layout ? <p className="mt-1 text-amber-800">{style.note}</p> : null}
      {offer ? (
        <button type="button" onClick={() => onUse(offer)} className="mt-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/20 active:scale-95">
          Use {style.suggestedName}
        </button>
      ) : null}
    </div>
  );
}

function Seg({ options, value, onChange, label }: { options: readonly { id: string; name: string }[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-white/60 p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={`min-h-8 rounded-full px-2.5 text-[11px] font-medium transition active:scale-95 ${value === o.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}>{o.name}</button>
      ))}
    </div>
  );
}

function QuickToggle({ on, onChange, icon: Icon, label }: { on: boolean; onChange: (v: boolean) => void; icon: LucideIcon; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition active:scale-95 ${on ? "bg-primary text-primary-foreground shadow" : "bg-white/60 text-muted-foreground hover:text-foreground"}`}>
      <Icon className="size-3.5" aria-hidden="true" />{label}
    </button>
  );
}

/** Moves one edge, keeping the clip inside the video and between 3 seconds and 10 minutes. */
function clampRange(edge: "in" | "out", ms: number, start: number, end: number, source: number | null) {
  const round = (v: number) => Math.round(v / 100) * 100;
  if (edge === "in") {
    const v = round(Math.min(Math.max(ms, 0, end - MAX_CLIP_MS), end - MIN_CLIP_MS));
    return { in: v, out: end };
  }
  const v = round(Math.max(Math.min(ms, source ?? Number.POSITIVE_INFINITY, start + MAX_CLIP_MS), start + MIN_CLIP_MS));
  return { in: start, out: v };
}

/**
 * The clip on a stretch of its source, zoomed so the handles are usable on a
 * phone: coloured shot segments, a tick for every spoken word, and a playhead
 * that follows the preview. The stretch is fixed per clip so it doesn't move
 * under a dragging finger; drags are applied once per frame, and the preview
 * jumps to the edge being moved.
 */
function Timeline({ start, end, baseStart, baseEnd, source, clipStart, words, shots, timeRef, onChange, onScrub }: {
  start: number; end: number; baseStart: number; baseEnd: number; source: number | null;
  clipStart: number; words: { start_ms: number; end_ms: number }[]; shots: { start_ms: number; end_ms: number; kind: string }[];
  timeRef: MutableRefObject<number>;
  onChange: (r: { in: number; out: number }) => void;
  onScrub: (ms: number | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const drag = useRef<"in" | "out" | null>(null);
  const pending = useRef<number | null>(null);
  const frameId = useRef(0);
  const pad = Math.max(15_000, (baseEnd - baseStart) * 0.6);
  const winStart = Math.max(0, baseStart - pad);
  const winEnd = Math.max(Math.min(source ?? baseEnd + pad, baseEnd + pad), winStart + 1);
  const span = winEnd - winStart;
  const pctN = (ms: number) => Math.min(100, Math.max(0, ((ms - winStart) / span) * 100));
  const pct = (ms: number) => `${pctN(ms)}%`;

  // The playhead moves on its own frame loop, so playback never re-renders the editor.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (head.current) head.current.style.left = pct(timeRef.current || start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const toMs = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return winStart + ((clientX - rect.left) / rect.width) * span;
  };
  const flush = () => {
    frameId.current = 0;
    const ms = pending.current;
    if (ms === null || !drag.current) return;
    const r = clampRange(drag.current, Math.min(Math.max(ms, winStart), winEnd), start, end, source);
    onChange(r);
    onScrub(drag.current === "in" ? r.in : r.out);
  };
  const down = (edge: "in" | "out") => (e: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = edge;
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(edge === "in" ? start : end);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    pending.current = toMs(e.clientX);
    if (!frameId.current) frameId.current = requestAnimationFrame(flush);
  };
  const up = () => { drag.current = null; pending.current = null; onScrub(null); };
  const key = (edge: "in" | "out") => (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 5000 : 500;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clampRange(edge, (edge === "in" ? start : end) + (e.key === "ArrowLeft" ? -step : step), start, end, source));
    }
  };

  return (
    <div className="glass w-full max-w-2xl rounded-2xl p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium"><Scissors className="size-3.5 text-primary" aria-hidden="true" />Where it comes from</span>
        <span className="tabular-nums text-muted-foreground">{clock(start)} – {clock(end)} · <span className="font-semibold text-foreground">{clock(end - start)}</span></span>
      </div>
      <div ref={track} className="relative h-14 touch-none select-none overflow-hidden rounded-lg bg-primary/10">
        {/* shots, as the Engine cut them */}
        {shots.map((s, i) => (
          <div key={i} className={`absolute top-0 h-1.5 ${KIND_COLOUR[s.kind] ?? "bg-primary"} opacity-70`} style={{ left: pct(clipStart + s.start_ms), width: `${Math.max(0.3, pctN(clipStart + s.end_ms) - pctN(clipStart + s.start_ms))}%` }} aria-hidden="true" />
        ))}
        {/* a tick for each word, so sentence starts and pauses are visible */}
        {words.map((w, i) => (
          <span key={i} className="absolute bottom-1.5 w-px bg-foreground/25" style={{ left: pct(clipStart + w.start_ms), height: `${30 + ((i * 37) % 40)}%` }} aria-hidden="true" />
        ))}
        {/* where the clip was before this edit */}
        <div className="absolute inset-y-2 rounded border border-dashed border-primary/40" style={{ left: pct(baseStart), width: `calc(${pct(baseEnd)} - ${pct(baseStart)})` }} aria-hidden="true" />
        <div className="absolute inset-y-0 rounded-md border-2 border-primary bg-primary/20 shadow-[0_0_0_9999px_rgb(255_255_255/0.35)]" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} aria-hidden="true" />
        <div ref={head} className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-red-500 shadow-[0_0_6px_rgb(239_68_68/0.8)]" aria-hidden="true">
          <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-red-500" />
        </div>
        {(["in", "out"] as const).map((edge) => (
          <button key={edge} type="button" role="slider" aria-label={edge === "in" ? "Clip start" : "Clip end"}
            aria-valuemin={Math.round(winStart / 1000)} aria-valuemax={Math.round(winEnd / 1000)} aria-valuenow={Math.round((edge === "in" ? start : end) / 1000)} aria-valuetext={clock(edge === "in" ? start : end, true)}
            onPointerDown={down(edge)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key(edge)}
            className="group/h absolute inset-y-0 z-30 flex w-7 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            style={{ left: pct(edge === "in" ? start : end) }}>
            <span className="h-9 w-2 rounded-full bg-primary shadow transition group-hover/h:h-11 group-hover/h:w-2.5 group-active/h:scale-110" />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{clock(winStart)}</span><span>{clock(winEnd)}</span></div>
    </div>
  );
}
