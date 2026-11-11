import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Captions, Crop, Download, Info, Loader2, Minus, Plus, Scissors, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import type { Clip, Job } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { saveAssistantDraft } from "@/lib/assistant-draft";
import { CLIP_LAYOUTS, type ClipLayout, groupCaptionLines, MAX_CLIP_MS, MIN_CLIP_MS, VIDEO_ASPECTS, type VideoAspect } from "@/lib/video-clips";
import { getVideoClipEditor, renameVideoClip, renderVideoClip, saveVideoClipEdits } from "@/lib/video-clips.functions";

type Tab = "details" | "captions" | "framing" | "trim";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "details", label: "Details", icon: Info },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "framing", label: "Framing", icon: Crop },
  { id: "trim", label: "Trim", icon: Scissors },
];
const RATIO: Record<VideoAspect, string> = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "4:5": "aspect-[4/5]", "16:9": "aspect-video" };
const isAspect = (v: unknown): v is VideoAspect => (VIDEO_ASPECTS as readonly unknown[]).includes(v);
const isLayout = (v: unknown): v is ClipLayout => CLIP_LAYOUTS.some((l) => l.id === v);

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

/**
 * Studio's clip editor. Title, Ask Co-Work, posting and downloading work on
 * their own; caption style and words, layout, shape and trim are read from the
 * clip's Engine project and saved back to it, which makes the video again.
 */
export function ClipEditor({ clip, job, onClose }: { clip: Clip; job: Job; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const renameFn = useServerFn(renameVideoClip);
  const renderFn = useServerFn(renderVideoClip);
  const editorFn = useServerFn(getVideoClipEditor);
  const saveFn = useServerFn(saveVideoClipEdits);
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState(clip.title ?? "");
  useEffect(() => setTitle(clip.title ?? ""), [clip.id, clip.title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reading the project wakes the Engine, so only once an editing tab is opened.
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

  // Edits, reset to what the Engine has whenever it answers again (after a save, say).
  const [styleId, setStyleId] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState<boolean | null>(null);
  const [layout, setLayout] = useState<ClipLayout | null>(null);
  const [aspect, setAspect] = useState<VideoAspect | null>(null);
  const [lineTexts, setLineTexts] = useState<Record<number, string>>({});
  useEffect(() => {
    setStyleId(null); setCaptionsOn(null); setLayout(null); setAspect(null); setLineTexts({});
  }, [editor.dataUpdatedAt]);

  const baseStart = settings?.inMs ?? clip.start_ms ?? 0;
  const baseEnd = settings?.outMs ?? clip.end_ms ?? baseStart + (clip.duration_ms ?? 0);
  const [range, setRange] = useState<{ in: number; out: number } | null>(null);
  useEffect(() => setRange(null), [clip.id, baseStart, baseEnd]);
  const start = range?.in ?? baseStart;
  const end = range?.out ?? baseEnd;

  const currentStyle = styleId ?? settings?.styleId ?? "bold_white";
  const currentCaptionsOn = captionsOn ?? settings?.captionsOn ?? true;
  const currentLayout = layout ?? (isLayout(settings?.layout) ? settings.layout : "auto");
  const currentAspect = aspect ?? (isAspect(settings?.aspect) ? settings.aspect : isAspect(job.aspect) ? job.aspect : "9:16");
  const lines = useMemo(() => groupCaptionLines(editor.data?.words ?? []), [editor.data?.words]);
  const lineEdits = lines.filter((l) => lineTexts[l.start_ms] !== undefined && lineTexts[l.start_ms]!.replace(/\s+/g, " ").trim() !== l.text)
    .map((l) => ({ start_ms: l.start_ms, from: l.text, to: lineTexts[l.start_ms]! }));

  const changes: string[] = [];
  if (settings) {
    if (currentStyle !== settings.styleId) changes.push("caption style");
    if (currentCaptionsOn !== settings.captionsOn) changes.push(currentCaptionsOn ? "captions on" : "captions off");
    if (lineEdits.length) changes.push(`${lineEdits.length} caption line${lineEdits.length === 1 ? "" : "s"}`);
    if (currentLayout !== settings.layout) changes.push("layout");
    if (currentAspect !== settings.aspect) changes.push("shape");
  }
  const trimmed = start !== baseStart || end !== baseEnd;
  if (trimmed) changes.push("trim");

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
  const save = useMutation({
    mutationFn: () => saveFn({ data: {
      clipId: clip.id,
      ...(settings && currentStyle !== settings.styleId ? { styleId: currentStyle } : {}),
      ...(settings && currentCaptionsOn !== settings.captionsOn ? { captionsOn: currentCaptionsOn } : {}),
      ...(settings && currentLayout !== settings.layout ? { layout: currentLayout } : {}),
      ...(settings && currentAspect !== settings.aspect ? { aspect: currentAspect } : {}),
      ...(trimmed ? { inMs: start, outMs: end } : {}),
      ...(lineEdits.length ? { lineEdits } : {}),
    } }),
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
  const styleDef = editor.data?.styles.find((s) => s.id === currentStyle);
  const stylePosition = styleDef?.defaults.position ?? "middle";
  const sampleLine = lines.find((l) => l.text)?.text ?? "This is how it looks";
  const source = job.duration_ms ?? null;

  return (
    <Portal>
      <div role="dialog" aria-modal="true" aria-label={`Edit ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-background">
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
            <div className={`relative w-full max-w-[min(22rem,100%)] overflow-hidden rounded-3xl bg-black shadow-xl ${RATIO[currentAspect]} ${currentAspect === "16:9" ? "max-w-[min(40rem,100%)]" : currentAspect === "9:16" ? "lg:max-w-[min(22rem,calc((100dvh-16rem)*9/16))]" : ""}`}>
              {ready && clip.video_url ? (
                <video key={clip.video_url} src={clip.video_url} controls playsInline poster={clip.thumbnail_url ?? undefined} className="size-full object-contain" />
              ) : clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
              {tab === "captions" && currentCaptionsOn ? (
                <div className={`pointer-events-none absolute inset-x-4 flex justify-center text-center ${stylePosition === "top" ? "top-[14%]" : stylePosition === "lower" ? "bottom-[10%]" : "top-1/2 -translate-y-1/2"}`}>
                  <span className={look(currentStyle).className} style={{ fontSize: "1.3rem", lineHeight: 1.15 }}>
                    {look(currentStyle).highlight ? (() => { const [first, ...rest] = sampleLine.split(" "); return <><span className="text-[#FFD60A]">{first}</span>{rest.length ? ` ${rest.join(" ")}` : ""}</>; })() : sampleLine}
                  </span>
                </div>
              ) : null}
              {!ready ? (
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
                  </Group>
                  {clip.reason ? <Group title="Why Co-Work picked it"><p className="text-sm leading-relaxed">{clip.reason}</p></Group> : null}
                  <Group title="Ask Co-Work">
                    <div className="grid gap-2">
                      {[
                        ["Write a caption", `Write a caption for the clip called "${name.slice(0, 120)}".`],
                        ["Suggest a better title", `Suggest three punchier titles for the clip called "${name.slice(0, 120)}".`],
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
                  ) : <><Loader2 className="size-5 animate-spin" aria-hidden="true" /><p>Loading the clip's settings…</p></>}
                </div>
              ) : null}

              {tab === "captions" && settings ? (
                <>
                  <Group title="Captions" action={
                    <button type="button" role="switch" aria-checked={currentCaptionsOn} aria-label="Show captions" onClick={() => setCaptionsOn(!currentCaptionsOn)} className={`relative h-6 w-11 rounded-full transition ${currentCaptionsOn ? "bg-primary" : "bg-muted-foreground/30"}`}>
                      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${currentCaptionsOn ? "left-[1.375rem]" : "left-0.5"}`} />
                    </button>
                  }>
                    <p className="text-xs text-muted-foreground">{currentCaptionsOn ? "Words are burned into the video." : "No words on the video."}</p>
                  </Group>
                  {currentCaptionsOn ? (
                    <>
                      <Group title="Style">
                        <div className="grid grid-cols-2 gap-2">
                          {editor.data!.styles.map((s) => (
                            <button key={s.id} type="button" onClick={() => setStyleId(s.id)} aria-pressed={currentStyle === s.id} className={`grid min-h-16 place-items-center rounded-xl bg-[oklch(0.3_0.05_258)] px-2 text-sm ring-primary transition ${currentStyle === s.id ? "ring-2" : "hover:ring-1"}`}>
                              <span className={look(s.id).className}>{s.name}</span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Each style has its own size and place on the video; the preview shows roughly where.</p>
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

              {tab === "framing" && settings ? (
                <>
                  <Group title="Layout">
                    <div className="grid gap-2">
                      {CLIP_LAYOUTS.map((l) => (
                        <button key={l.id} type="button" onClick={() => setLayout(l.id)} aria-pressed={currentLayout === l.id} className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 text-left ${currentLayout === l.id ? "border-primary bg-primary/10" : "border-border bg-white/50 hover:bg-white/70"}`}>
                          <span className="text-sm font-medium">{l.label}</span><span className="text-xs text-muted-foreground">{l.hint}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Split screen needs two people in the same shot; otherwise it follows the speaker.</p>
                  </Group>
                  <Group title="Shape">
                    <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/50 p-1">
                      {VIDEO_ASPECTS.map((a) => <button key={a} type="button" onClick={() => setAspect(a)} aria-pressed={currentAspect === a} className={`min-h-9 rounded-lg text-xs font-medium ${currentAspect === a ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{a}</button>)}
                    </div>
                    <p className="text-[11px] text-muted-foreground">9:16 for Reels, TikTok and Shorts; 1:1 or 4:5 for feeds; 16:9 for YouTube.</p>
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

            {tab !== "details" ? (
              <div className="shrink-0 border-t border-border/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button className="min-h-11 w-full" disabled={!changes.length || save.isPending || making || !settings} onClick={() => save.mutate()}>
                  {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Save and re-make video
                </Button>
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {making ? "The video is being made. You can save more changes once it's finished." : changes.length ? `Changing ${changes.join(", ")}.` : "Make a change to save it."}
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
            className="absolute inset-y-0 z-10 flex w-7 -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
            style={{ left: pct(edge === "in" ? start : end) }}>
            <span className="h-8 w-2 rounded-full bg-primary shadow" />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{clock(winStart)}</span><span>{clock(winEnd)}</span></div>
    </div>
  );
}
