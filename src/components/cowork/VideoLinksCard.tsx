import { useServerFn } from "@tanstack/react-start";
import { Check, Clapperboard, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { VideoLinksProposal } from "@/lib/assistant-proposals";
import { clipVideoLink } from "@/lib/video-clips.functions";

const length = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type RowState = "idle" | "starting" | "started" | "failed";

/**
 * Several looked-up links at once: choose which to clip, tick once that you
 * own them or have permission, and they all start. Only the owner's own tick
 * and press start anything; each video is a job of its own in Studio.
 */
export function VideoLinksCard({ proposal, onDone }: { proposal: VideoLinksProposal; onDone: (message: string) => void }) {
  const clip = useServerFn(clipVideoLink);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(proposal.videos.map((v) => v.url)));
  const [owned, setOwned] = useState(false);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const picked = proposal.videos.filter((v) => chosen.has(v.url));

  const start = async () => {
    setRunning(true);
    let started = 0;
    for (const v of picked) {
      if (state[v.url] === "started") { started++; continue; }
      setState((s) => ({ ...s, [v.url]: "starting" }));
      try {
        await clip({ data: { url: v.url, name: v.title.slice(0, 200), rightsConfirmed: true } });
        started++;
        setState((s) => ({ ...s, [v.url]: "started" }));
      } catch (e) {
        setState((s) => ({ ...s, [v.url]: "failed" }));
        setErrors((x) => ({ ...x, [v.url]: e instanceof Error ? e.message : "Couldn't start." }));
      }
    }
    setRunning(false);
    const failed = picked.length - started;
    if (failed === 0) onDone(`Started cutting ${started} video${started === 1 ? "" : "s"} into clips. They'll appear in Studio and Results over the next few minutes.`);
  };

  const toggle = (url: string) => setChosen((c) => {
    const next = new Set(c);
    if (next.has(url)) next.delete(url); else next.add(url);
    return next;
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card text-sm">
      <ul className="divide-y divide-border">
        {proposal.videos.map((v) => {
          const st = state[v.url] ?? "idle";
          return (
            <li key={v.url} className="flex items-center gap-3 p-2.5">
              <input type="checkbox" aria-label={`Clip ${v.title}`} checked={chosen.has(v.url)} disabled={running || st === "started"}
                onChange={() => toggle(v.url)} className="size-4 shrink-0" />
              {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="aspect-video w-20 shrink-0 rounded-md object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-medium">{v.title}</p>
                <p className="truncate text-xs text-muted-foreground">{v.channel}{v.durationMs ? ` · ${length(v.durationMs)}` : ""}</p>
                {st === "failed" ? <p className="text-xs text-destructive">{errors[v.url]}</p> : null}
              </div>
              <span className="shrink-0" aria-live="polite">
                {st === "starting" ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Starting" />
                  : st === "started" ? <Check className="size-4 text-emerald-600" aria-label="Started" />
                    : st === "failed" ? <X className="size-4 text-destructive" aria-label="Couldn't start" /> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {proposal.missed.length ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Couldn't read {proposal.missed.length === 1 ? "one link" : `${proposal.missed.length} links`}: {proposal.missed.join(", ")}
        </p>
      ) : null}
      <div className="space-y-2 border-t border-border p-3">
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
          I own these videos or have permission to clip them
        </label>
        <Button size="sm" className="min-h-10 w-full sm:w-auto" disabled={!owned || running || picked.length === 0} onClick={() => void start()}>
          {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}
          {picked.some((v) => state[v.url] === "failed") ? "Try the rest again" : `Clip ${picked.length} video${picked.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
