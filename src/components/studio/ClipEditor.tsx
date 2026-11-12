import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Captions, Crop, Download, Eye, Info, Loader2, Minus, Plus, Scissors, Send, Sparkles, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import type { Clip, Job } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { saveAssistantDraft } from "@/lib/assistant-draft";
import { CAPTION_POSITIONS, CAPTION_SIZE, type CaptionPosition, CLIP_LAYOUT_IDS, CLIP_ZOOM_IDS, type ClipLayout, type ClipZoom, groupCaptionLines, MAX_CLIP_MS, MIN_CLIP_MS, SHOT_KINDS, TITLE_POSITIONS, TITLE_STYLE_IDS, type TitlePosition, type TitleStyle, VIDEO_ASPECTS, type VideoAspect } from "@/lib/video-clips";
import { getVideoClipEditor, getVideoClipPlan, previewVideoClipEdits, renameVideoClip, renderVideoClip, saveVideoClipEdits } from "@/lib/video-clips.functions";

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
  const previewFn = useServerFn(previewVideoClipEdits);
  const saveFn = useServerFn(saveVideoClipEdits);
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
  const [wantEditor, setWantEditor] = useState(false);
  useEffect(() => { if (tab !== "details") setWantEditor(true); }, [tab]);
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
  const [layout, setLayout] = useState<ClipLayout | null>(null);
  const [zoom, setZoom] = useState<ClipZoom | null>(null);
  const [aspect, setAspect] = useState<VideoAspect | null>(null);
  const [headline, setHeadline] = useState<{ text?: string; enabled?: boolean; style?: TitleStyle; position?: TitlePosition }>({});
  const [lineTexts, setLineTexts] = useState<Record<number, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    setStyleId(null); setCaptionsOn(null); setCaptionPosition(undefined); setCaptionSize(null); setLayout(null); setZoom(null); setAspect(null); setHeadline({}); setLineTexts({}); setPreviewUrl(null);
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
  const plan = useQuery({
    queryKey: ["video-clip-plan", clip.id, current.layout, current.zoom, current.aspect],
    queryFn: () => planFn({ data: { clipId: clip.id, layout: current.layout, zoom: current.zoom, aspect: current.aspect } }),
    enabled: tab === "framing" && Boolean(settings),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

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
  const preview = useMutation({
    mutationFn: () => previewFn({ data: { clipId: clip.id, ...edits } }),
    onSuccess: (r) => setPreviewUrl(r.url),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The preview couldn't be made."),
  });
  const save = useMutation({
    mutationFn: () => saveFn({ data: { clipId: clip.id, ...edits, ...(lineEdits.length ? { lineEdits } : {}) } }),
    onSuccess: async () => {
      toast.success("Saved. Making the video again; it takes a minute or two.");
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
  const shownVideo = previewUrl ?? (ready ? clip.video_url : null);

  return (
    <Portal>
      <div role="dialog" aria-modal="true" aria-label={`Edit ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-[var(--canvas)] [background-image:var(--canvas-gradient)]">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 sm:px-5">
          <Button variant="ghost" size="sm" className="min-h-10" onClick={onClose}><ArrowLeft className="size-4" aria-hidden="true" />Library</Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{job.source_name}</p>
          </div>
          {ready ? (
            <>
              <Button asChild variant="outline" size="sm" className="hidden min-h-10 sm:inline-flex"><a href={clip.video_url ?? undefined} download><Download className="size-4" aria-hidden="true" />Download</a></Button>
              <Button asChild size="sm" className="btn-glow min-h-10"><Link to="/social" search={{ platform: "youtube", clip: clip.id, clipTitle: name.slice(0, 100) }}><Send className="size-4" aria-hidden="true" />Post</Link></Button>
            </>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* Preview and timeline */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-4 p-4 lg:overflow-y-auto lg:p-6">
            <div className={`relative w-full max-w-[min(22rem,100%)] overflow-hidden rounded-3xl bg-black shadow-xl ${RATIO[current.aspect]} ${current.aspect === "16:9" ? "max-w-[min(40rem,100%)]" : current.aspect === "9:16" ? "lg:max-w-[min(22rem,calc((100dvh-16rem)*9/16))]" : ""}`}>
              {shownVideo ? (
                <video key={shownVideo} src={shownVideo} controls playsInline autoPlay={Boolean(previewUrl)} muted={Boolean(previewUrl)} poster={previewUrl ? undefined : (clip.thumbnail_url ?? undefined)} className="size-full object-contain" />
              ) : clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
              {previewUrl ? (
                <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2 rounded-xl bg-black/60 px-3 py-1.5 text-xs text-white">
                  <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" aria-hidden="true" />Preview of your changes</span>
                  <button type="button" onClick={() => setPreviewUrl(null)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/15"><X className="size-3.5" aria-hidden="true" />Current video</button>
                </div>
              ) : null}
              {tab === "captions" && current.captionsOn && !previewUrl ? (
                <div className={`pointer-events-none absolute inset-x-4 flex justify-center text-center ${stylePosition === "top" ? "top-[14%]" : stylePosition === "lower" ? "bottom-[10%]" : "top-1/2 -translate-y-1/2"}`}>
                  <span className={look(current.styleId).className} style={{ fontSize: `${1.3 * current.captionSize}rem`, lineHeight: 1.15 }}>
                    {look(current.styleId).highlight ? (() => { const [first, ...rest] = sampleLine.split(" "); return <><span className="text-[#FFD60A]">{first}</span>{rest.length ? ` ${rest.join(" ")}` : ""}</>; })() : sampleLine}
                  </span>
                </div>
              ) : null}
              {!ready && !previewUrl ? (
                <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/60 p-2.5 text-center text-xs text-white">
                  {making ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Making the video…</span> : clip.status === "FAILED" ? (clip.error ?? "This clip couldn't be made.") : "Not made into a video yet."}
                </div>
              ) : null}
            </div>

            <Timeline start={start} end={end} baseStart={clip.start_ms ?? baseStart} baseEnd={clip.end_ms ?? baseEnd} source={source}
              onChange={(r) => { setRange(r); if (tab !== "trim") setTab("trim"); }} />
          </div>

          {/* Tools */}
          <aside className="flex w-full shrink-0 flex-col border-t border-border/60 lg:w-[26rem] lg:border-l lg:border-t-0">
            <nav aria-label="Editor tools" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 p-2">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium ${tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/60 hover:text-foreground"}`}>
                  <t.icon className="size-4" aria-hidden="true" />{t.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 space-y-6 p-4 lg:overflow-y-auto">
              {tab === "details" ? (
                <>
                  <Group title="Title">
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!saved && title.trim()) rename.mutate(); }}>
                      <input aria-label="Clip title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-xl border border-input bg-white/70 px-3 text-base outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm" />
                      <Button type="submit" variant="outline" className="min-h-10" disabled={saved || !title.trim() || rename.isPending}>{rename.isPending ? "Saving…" : "Save"}</Button>
                    </form>
                    <p className="text-[11px] text-muted-foreground">The name used when you post. The headline burned onto the video is below.</p>
                  </Group>
                  <Group title="Headline on the video" action={settings ? <Switch on={current.headlineEnabled} onChange={(v) => setHeadline((h) => ({ ...h, enabled: v }))} label="Show the headline on the video" /> : null}>
                    {!settings ? (
                      <button type="button" onClick={() => setWantEditor(true)} className="glass flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm hover:bg-white/70">
                        <span>Edit the headline, style and position</span>{editor.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                      </button>
                    ) : current.headlineEnabled ? (
                      <>
                        <input aria-label="Headline on the video" value={current.headlineText} maxLength={120} onChange={(e) => setHeadline((h) => ({ ...h, text: e.target.value }))} placeholder="A line that makes someone stop" className="min-h-10 w-full rounded-xl border border-input bg-white/70 px-3 text-base outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm" />
                        {catalog ? <Chips options={catalog.titleStyles.filter((t) => isTitleStyle(t.id)) as { id: TitleStyle; name: string; hint?: string | null }[]} value={current.headlineStyle} onChange={(v) => setHeadline((h) => ({ ...h, style: v }))} label="Headline style" cols={4} /> : null}
                        <Chips options={[{ id: "auto", name: "Auto", hint: "Top, unless the head is up there" }, { id: "top", name: "Top" }, { id: "bottom", name: "Bottom" }] as const} value={current.headlinePosition} onChange={(v) => setHeadline((h) => ({ ...h, position: v }))} label="Headline position" />
                      </>
                    ) : <p className="text-xs text-muted-foreground">No headline on the video.</p>}
                  </Group>
                  {clip.reason ? <Group title="Why Co-Work picked it"><p className="text-sm leading-relaxed">{clip.reason}</p></Group> : null}
                  <Group title="Ask Co-Work">
                    <div className="grid gap-2">
                      {[
                        ["Write a caption", `Write a caption for the clip called "${name.slice(0, 120)}".`],
                        ["Suggest a better title", `Suggest three punchier titles for the clip called "${name.slice(0, 120)}".`],
                        ["How is it framed?", `Explain how the clip called "${name.slice(0, 120)}" is framed, shot by shot, and whether a different layout would suit it better.`],
                        ["Where should I post it?", `Which channel and time should I post the clip called "${name.slice(0, 120)}" on, and why?`],
                      ].map(([label, prompt]) => (
                        <button key={label} type="button" onClick={() => askCowork(prompt as string)} className="glass flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-white/70">
                          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />{label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Opens Co-Work with the question ready; you press send.</p>
                  </Group>
                  {!ready && (clip.status === "FOUND" || clip.status === "FAILED") ? (
                    <Button className="min-h-11 w-full" disabled={render.isPending} onClick={() => render.mutate()}>{render.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{clip.status === "FAILED" ? "Try again" : "Make video"}</Button>
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
                    <p className="text-xs text-muted-foreground">{current.captionsOn ? "Words are burned into the video." : "No words on the video."}</p>
                  </Group>
                  {current.captionsOn ? (
                    <>
                      <Group title="Style">
                        <div className="grid grid-cols-2 gap-2">
                          {catalog.captionStyles.map((s) => (
                            <button key={s.id} type="button" onClick={() => setStyleId(s.id)} aria-pressed={current.styleId === s.id} className={`grid min-h-16 place-items-center rounded-xl bg-[oklch(0.3_0.05_258)] px-2 text-sm ring-primary transition ${current.styleId === s.id ? "ring-2" : "hover:ring-1"}`}>
                              <span className={look(s.id).className}>{s.name}</span>
                            </button>
                          ))}
                        </div>
                      </Group>
                      <Group title="Position">
                        <Chips options={[{ id: "style", name: "Style's own", hint: `This style puts the words ${styleDef?.defaults.position === "lower" ? "low" : styleDef?.defaults.position === "top" ? "high" : "in the middle"}` }, ...catalog.captionPositions.filter((p) => (CAPTION_POSITIONS as readonly string[]).includes(p.id))]} value={current.captionPosition ?? "style"} onChange={(v) => setCaptionPosition(v === "style" ? null : (v as CaptionPosition))} label="Caption position" cols={4} />
                      </Group>
                      <Group title={`Size · ${Math.round(current.captionSize * 100)}%`}>
                        <input type="range" min={catalog.captionSize.min} max={catalog.captionSize.max} step={CAPTION_SIZE.step} value={current.captionSize} onChange={(e) => setCaptionSize(Number(e.target.value))} aria-label="Caption size" className="w-full accent-[var(--color-primary)]" />
                      </Group>
                      <Group title="Words" action={lineEdits.length ? <button type="button" className="text-xs text-primary" onClick={() => setLineTexts({})}>Undo fixes</button> : null}>
                        {lines.length ? (
                          <ol className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
                            {lines.map((l) => (
                              <li key={l.start_ms} className="flex items-center gap-2">
                                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{clock(l.start_ms)}</span>
                                <input aria-label={`Caption at ${clock(l.start_ms)}`} value={lineTexts[l.start_ms] ?? l.text} maxLength={400}
                                  onChange={(e) => setLineTexts((t) => ({ ...t, [l.start_ms]: e.target.value }))}
                                  className={`min-h-10 min-w-0 flex-1 rounded-lg border bg-white/70 px-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm ${lineTexts[l.start_ms] !== undefined && lineTexts[l.start_ms] !== l.text ? "border-primary" : "border-input"}`} />
                              </li>
                            ))}
                          </ol>
                        ) : <p className="text-sm text-muted-foreground">No words were heard in this clip.</p>}
                        <p className="text-[11px] text-muted-foreground">Fix any word the captions got wrong. Clear a line to drop it.</p>
                      </Group>
                    </>
                  ) : null}
                </>
              ) : null}

              {tab === "framing" && settings && catalog ? (
                <>
                  <Group title="Layout">
                    <div className="grid gap-2">
                      {catalog.layouts.filter((l) => isLayout(l.id)).map((l) => (
                        <button key={l.id} type="button" onClick={() => setLayout(l.id as ClipLayout)} aria-pressed={current.layout === l.id} className={`flex min-h-12 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left ${current.layout === l.id ? "border-primary bg-primary/10" : "border-border bg-white/50 hover:bg-white/70"}`}>
                          <span className="flex w-full items-center justify-between gap-2"><span className="text-sm font-medium">{l.name}</span>{l.needs ? <span className="text-[10px] text-muted-foreground">needs {l.needs}</span> : null}</span>
                          {l.hint ? <span className="text-xs text-muted-foreground">{l.hint}</span> : null}
                        </button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Zoom">
                    <div className="grid gap-1.5">
                      {catalog.zoom.filter((z) => isZoom(z.id)).map((z) => (
                        <button key={z.id} type="button" onClick={() => setZoom(z.id as ClipZoom)} aria-pressed={current.zoom === z.id} className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-left ${current.zoom === z.id ? "border-primary bg-primary/10" : "border-border bg-white/50 hover:bg-white/70"}`}>
                          <span className="text-sm font-medium">{z.name}</span><span className="text-xs text-muted-foreground">{z.hint}</span>
                        </button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Shape">
                    <Chips options={VIDEO_ASPECTS.map((a) => ({ id: a, name: a }))} value={current.aspect} onChange={setAspect} label="Shape" cols={4} />
                    <p className="text-[11px] text-muted-foreground">9:16 for Reels, TikTok and Shorts; 1:1 or 4:5 for feeds; 16:9 for YouTube.</p>
                  </Group>
                  <Group title="How the Engine will cut it" action={plan.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}>
                    {plan.data ? (
                      <>
                        <div className="flex h-3 w-full overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
                          {plan.data.shots.map((s, i) => {
                            const total = Math.max(1, plan.data!.shots[plan.data!.shots.length - 1]!.end_ms);
                            return <span key={i} title={SHOT_KINDS[s.kind] ?? s.kind} className={`${KIND_COLOUR[s.kind] ?? "bg-primary"} ${i ? "border-l border-white/70" : ""}`} style={{ width: `${((s.end_ms - s.start_ms) / total) * 100}%` }} />;
                          })}
                        </div>
                        <ol className="max-h-56 space-y-1 overflow-y-auto text-xs">
                          {plan.data.shots.map((s, i) => (
                            <li key={i} className="flex gap-2">
                              <span className={`mt-1 size-2 shrink-0 rounded-full ${KIND_COLOUR[s.kind] ?? "bg-primary"}`} aria-hidden="true" />
                              <span className="w-[5.5rem] shrink-0 tabular-nums text-muted-foreground">{clock(s.start_ms)}–{clock(s.end_ms)}</span>
                              <span className="min-w-0"><span className="font-medium">{SHOT_KINDS[s.kind] ?? s.kind}{s.zoom > 1.01 ? ` · ${s.zoom.toFixed(2)}×` : ""}</span>{s.why ? <span className="text-muted-foreground"> — {s.why}</span> : null}</span>
                            </li>
                          ))}
                        </ol>
                        <p className="text-[11px] text-muted-foreground">{plan.data.people} {plan.data.people === 1 ? "person" : "people"} found, {plan.data.cuts.length} camera cut{plan.data.cuts.length === 1 ? "" : "s"}. Change the layout or zoom above to see what it would do.</p>
                      </>
                    ) : plan.isError ? <p className="text-xs text-destructive">{plan.error instanceof Error ? plan.error.message : "The Engine couldn't read this clip."}</p>
                      : <p className="text-xs text-muted-foreground">Reading the clip's faces, voices and cuts…</p>}
                  </Group>
                </>
              ) : null}

              {tab === "trim" && settings ? (
                <Group title="Start and end">
                  <div className="grid grid-cols-2 gap-3">
                    {([["Starts at", "in"], ["Ends at", "out"]] as const).map(([label, edge]) => {
                      const value = edge === "in" ? start : end;
                      const nudge = (delta: number) => setRange(clampRange(edge, value + delta, start, end, source));
                      return (
                        <div key={edge} className="text-xs text-muted-foreground">{label}
                          <div className="mt-1 flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" aria-label={`${label} one second earlier`} onClick={() => nudge(-1000)}><Minus className="size-4" aria-hidden="true" /></Button>
                            <span className="min-w-0 flex-1 text-center text-sm font-medium tabular-nums text-foreground">{clock(value, true)}</span>
                            <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" aria-label={`${label} one second later`} onClick={() => nudge(1000)}><Plus className="size-4" aria-hidden="true" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Drag the handles on the timeline, or nudge a second at a time. {clock(end - start)} long.</p>
                  {trimmed ? <button type="button" className="text-xs text-primary" onClick={() => setRange(null)}>Undo trim</button> : null}
                </Group>
              ) : null}
            </div>

            {tab !== "details" || (settings && changes.length) ? (
              <div className="shrink-0 border-t border-border/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex gap-2">
                  <Button variant="outline" className="min-h-11 shrink-0" disabled={!changes.length || preview.isPending || save.isPending || !settings || lineEdits.length === changes.length} onClick={() => preview.mutate()} title="A quick half-size preview with these changes; nothing is saved">
                    {preview.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}Preview
                  </Button>
                  <Button className="min-h-11 flex-1" disabled={!changes.length || save.isPending || making || !settings} onClick={() => save.mutate()}>
                    {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Save and re-make video
                  </Button>
                </div>
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {preview.isPending ? "The Engine is cutting a quick preview; it takes a little while." : making ? "The video is being made. You can save more changes once it's finished." : changes.length ? `Changing ${changes.join(", ")}.` : "Make a change to save it."}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </Portal>
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
 * phone. The stretch is fixed per clip so it doesn't move under a dragging finger.
 */
function Timeline({ start, end, baseStart, baseEnd, source, onChange }: {
  start: number; end: number; baseStart: number; baseEnd: number; source: number | null;
  onChange: (r: { in: number; out: number }) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<"in" | "out" | null>(null);
  const pad = Math.max(15_000, (baseEnd - baseStart) * 0.6);
  const winStart = Math.max(0, baseStart - pad);
  const winEnd = Math.max(Math.min(source ?? baseEnd + pad, baseEnd + pad), winStart + 1);
  const span = winEnd - winStart;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - winStart) / span) * 100))}%`;

  const toMs = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return winStart + ((clientX - rect.left) / rect.width) * span;
  };
  const down = (edge: "in" | "out") => (e: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = edge;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const ms = toMs(e.clientX);
    if (ms !== null) onChange(clampRange(drag.current, Math.min(Math.max(ms, winStart), winEnd), start, end, source));
  };
  const up = () => { drag.current = null; };
  const key = (edge: "in" | "out") => (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 5000 : 500;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clampRange(edge, (edge === "in" ? start : end) + (e.key === "ArrowLeft" ? -step : step), start, end, source));
    }
  };

  return (
    <div className="glass w-full max-w-2xl rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Where it comes from</span>
        <span className="tabular-nums text-muted-foreground">{clock(start)} – {clock(end)} · {clock(end - start)} long</span>
      </div>
      <div ref={track} className="relative h-12 touch-none select-none rounded-lg bg-primary/10">
        {/* where the clip was before this edit */}
        <div className="absolute inset-y-2 rounded border border-dashed border-primary/40" style={{ left: pct(baseStart), width: `calc(${pct(baseEnd)} - ${pct(baseStart)})` }} aria-hidden="true" />
        <div className="absolute inset-y-0 rounded-md border-2 border-primary bg-primary/25" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} aria-hidden="true" />
        {(["in", "out"] as const).map((edge) => (
          <button key={edge} type="button" role="slider" aria-label={edge === "in" ? "Clip start" : "Clip end"}
            aria-valuemin={Math.round(winStart / 1000)} aria-valuemax={Math.round(winEnd / 1000)} aria-valuenow={Math.round((edge === "in" ? start : end) / 1000)} aria-valuetext={clock(edge === "in" ? start : end, true)}
            onPointerDown={down(edge)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key(edge)}
            className="absolute inset-y-0 z-10 flex w-7 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            style={{ left: pct(edge === "in" ? start : end) }}>
            <span className="h-8 w-2 rounded-full bg-primary shadow" />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{clock(winStart)}</span><span>{clock(winEnd)}</span></div>
    </div>
  );
}
