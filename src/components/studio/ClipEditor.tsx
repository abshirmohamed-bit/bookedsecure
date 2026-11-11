import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Captions, Crop, Download, Info, Loader2, Scissors, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import type { Clip, Job } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { saveAssistantDraft } from "@/lib/assistant-draft";
import { renameVideoClip, renderVideoClip } from "@/lib/video-clips.functions";

type Tab = "details" | "captions" | "framing" | "trim";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "details", label: "Details", icon: Info },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "framing", label: "Framing", icon: Crop },
  { id: "trim", label: "Trim", icon: Scissors },
];

// Preview-only styles; the real ones will come from the Engine's subtitle styles.
const CAPTION_STYLES = [
  { id: "bold", label: "Bold pop", className: "font-black uppercase tracking-tight text-white [text-shadow:0_3px_0_rgb(0_0_0/0.7)]" },
  { id: "highlight", label: "Word highlight", className: "font-extrabold text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.6)]", highlight: true },
  { id: "boxed", label: "Boxed", className: "rounded-md bg-black/75 px-2 py-1 font-bold text-white" },
  { id: "clean", label: "Clean", className: "font-semibold text-white [text-shadow:0_1px_4px_rgb(0_0_0/0.6)]" },
  { id: "minimal", label: "Minimal", className: "font-medium text-white/95 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]" },
] as const;
type CaptionStyle = (typeof CAPTION_STYLES)[number]["id"];
const POSITIONS = [{ id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }] as const;
type Position = (typeof POSITIONS)[number]["id"];
const LAYOUTS = [
  { id: "auto", label: "Follow the speaker", hint: "Re-aims on every cut" },
  { id: "single", label: "One person", hint: "Hold on the main face" },
  { id: "split", label: "Split screen", hint: "Two people stacked" },
  { id: "wide", label: "Full shot", hint: "Fit the whole frame" },
] as const;
const ASPECTS = [{ id: "9:16", ratio: "aspect-[9/16]" }, { id: "1:1", ratio: "aspect-square" }, { id: "4:5", ratio: "aspect-[4/5]" }, { id: "16:9", ratio: "aspect-video" }] as const;
type Aspect = (typeof ASPECTS)[number]["id"];

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Soon() {
  return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Coming soon</span>;
}

function Group({ title, soon, children }: { title: string; soon?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>{soon ? <Soon /> : null}</div>
      {children}
    </section>
  );
}

/**
 * Studio's clip editor. Title, captions-by-Co-Work, posting, downloading and
 * making the video work now; the caption style, framing and trim controls are
 * laid out and preview locally, and will save through the Engine next.
 */
export function ClipEditor({ clip, job, onClose }: { clip: Clip; job: Job; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const renameFn = useServerFn(renameVideoClip);
  const renderFn = useServerFn(renderVideoClip);
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState(clip.title ?? "");
  const [style, setStyle] = useState<CaptionStyle>("bold");
  const [position, setPosition] = useState<Position>("bottom");
  const [size, setSize] = useState(100);
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]["id"]>("auto");
  const [aspect, setAspect] = useState<Aspect>((ASPECTS.some((a) => a.id === job.aspect) ? job.aspect : "9:16") as Aspect);
  useEffect(() => setTitle(clip.title ?? ""), [clip.id, clip.title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  const askCowork = (text: string) => { saveAssistantDraft(text); void navigate({ to: "/assistant" }); };

  const ready = clip.status === "READY" && Boolean(clip.video_url);
  const name = title.trim() || "Clip";
  const saved = (clip.title ?? "") === title.trim();
  const styleDef = CAPTION_STYLES.find((s) => s.id === style) ?? CAPTION_STYLES[0];
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? "aspect-[9/16]";
  const start = clip.start_ms ?? 0;
  const end = clip.end_ms ?? start + (clip.duration_ms ?? 0);
  const source = Math.max(job.duration_ms ?? 0, end, 1);
  const length = clip.duration_ms ?? end - start;

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
            <div className={`relative w-full max-w-[min(22rem,100%)] overflow-hidden rounded-3xl bg-black shadow-xl ${ratio} ${aspect === "16:9" ? "max-w-[min(40rem,100%)]" : aspect === "9:16" ? "lg:max-w-[min(22rem,calc((100dvh-16rem)*9/16))]" : ""}`}>
              {ready && clip.video_url ? (
                <video key={clip.video_url} src={clip.video_url} controls playsInline poster={clip.thumbnail_url ?? undefined} className="size-full object-contain" />
              ) : clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
              {tab === "captions" ? (
                <div className={`pointer-events-none absolute inset-x-4 flex justify-center text-center ${position === "top" ? "top-[12%]" : position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[16%]"}`}>
                  <span className={styleDef.className} style={{ fontSize: `${(size / 100) * 1.35}rem`, lineHeight: 1.15 }}>
                    {"highlight" in styleDef ? <>This is <span className="text-[oklch(0.85_0.17_95)]">how</span> it looks</> : "This is how it looks"}
                  </span>
                </div>
              ) : null}
              {!ready ? (
                <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/60 p-2.5 text-center text-xs text-white">
                  {clip.status === "EXPORTING" ? "Making the video…" : clip.status === "FAILED" ? (clip.error ?? "This clip couldn't be made.") : "Not made into a video yet."}
                </div>
              ) : null}
            </div>

            <div className="glass w-full max-w-2xl rounded-2xl p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">Where it comes from</span>
                <span className="text-muted-foreground">{clock(start)} – {clock(end)} · {clock(length)} long</span>
              </div>
              <div className="relative h-10 overflow-hidden rounded-lg bg-primary/10" aria-hidden="true">
                <div className="absolute inset-y-0 rounded-md border-2 border-primary bg-primary/25" style={{ left: `${(start / source) * 100}%`, width: `${Math.max(1.5, ((end - start) / source) * 100)}%` }}>
                  <span className="absolute inset-y-1 -left-1 w-1.5 rounded-full bg-primary" />
                  <span className="absolute inset-y-1 -right-1 w-1.5 rounded-full bg-primary" />
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0:00</span><span>{job.duration_ms ? clock(job.duration_ms) : ""}</span></div>
            </div>
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
              ) : null}

              {tab === "captions" ? (
                <>
                  <Group title="Style" soon>
                    <div className="grid grid-cols-2 gap-2">
                      {CAPTION_STYLES.map((s) => (
                        <button key={s.id} type="button" onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className={`grid min-h-16 place-items-center rounded-xl bg-[oklch(0.3_0.05_258)] px-2 text-sm ring-primary transition ${style === s.id ? "ring-2" : "hover:ring-1"}`}>
                          <span className={s.className}>{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Position">
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/50 p-1">
                      {POSITIONS.map((p) => <button key={p.id} type="button" onClick={() => setPosition(p.id)} aria-pressed={position === p.id} className={`min-h-9 rounded-lg text-xs font-medium ${position === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{p.label}</button>)}
                    </div>
                  </Group>
                  <Group title={`Size · ${size}%`}>
                    <input type="range" min={70} max={140} step={5} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Caption size" className="w-full accent-[var(--color-primary)]" />
                  </Group>
                  <Group title="Words" soon>
                    <textarea disabled rows={4} placeholder="Fix any word the captions got wrong, line by line." className="w-full resize-none rounded-xl border border-input bg-white/40 p-3 text-sm text-muted-foreground" />
                  </Group>
                </>
              ) : null}

              {tab === "framing" ? (
                <>
                  <Group title="Layout" soon>
                    <div className="grid gap-2">
                      {LAYOUTS.map((l) => (
                        <button key={l.id} type="button" onClick={() => setLayout(l.id)} aria-pressed={layout === l.id} className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 text-left ${layout === l.id ? "border-primary bg-primary/10" : "border-border bg-white/50 hover:bg-white/70"}`}>
                          <span className="text-sm font-medium">{l.label}</span><span className="text-xs text-muted-foreground">{l.hint}</span>
                        </button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Shape" soon>
                    <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/50 p-1">
                      {ASPECTS.map((a) => <button key={a.id} type="button" onClick={() => setAspect(a.id)} aria-pressed={aspect === a.id} className={`min-h-9 rounded-lg text-xs font-medium ${aspect === a.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{a.id}</button>)}
                    </div>
                    <p className="text-[11px] text-muted-foreground">The preview shows the new shape; saving it will re-make the video.</p>
                  </Group>
                </>
              ) : null}

              {tab === "trim" ? (
                <Group title="Start and end" soon>
                  <div className="grid grid-cols-2 gap-2">
                    {([["Starts at", start], ["Ends at", end]] as const).map(([label, ms]) => (
                      <label key={label} className="text-xs text-muted-foreground">{label}
                        <input disabled value={clock(ms)} readOnly className="mt-1 min-h-10 w-full rounded-xl border border-input bg-white/40 px-3 text-sm text-foreground" />
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Drag the handles on the timeline, or nudge a second at a time, to tighten the clip.</p>
                </Group>
              ) : null}
            </div>

            {tab !== "details" ? (
              <div className="shrink-0 border-t border-border/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button className="min-h-11 w-full" disabled>Save and re-make video</Button>
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Caption style, framing and trim save once the editor is switched on. Ask Co-Work meanwhile.</p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </Portal>
  );
}
