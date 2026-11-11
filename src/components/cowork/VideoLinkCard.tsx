import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clapperboard, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { VideoLinkProposal } from "@/lib/assistant-proposals";
import { clipVideoLink } from "@/lib/video-clips.functions";

const length = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** A looked-up video link. Only the owner's own tick and press start the clipping. */
export function VideoLinkCard({ proposal, onDone }: { proposal: VideoLinkProposal; onDone: (message: string) => void }) {
  const clip = useServerFn(clipVideoLink);
  const [owned, setOwned] = useState(false);
  const start = useMutation({
    mutationFn: () => clip({ data: { url: proposal.url, name: proposal.title.slice(0, 200), rightsConfirmed: true } }),
    onSuccess: () => onDone(`Started cutting "${proposal.title}" into clips. They'll appear in Results in a few minutes.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That video couldn't be clipped."),
  });
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card text-sm">
      <div className="flex gap-3 p-3">
        {proposal.thumbnailUrl ? <img src={proposal.thumbnailUrl} alt="" className="aspect-video w-32 shrink-0 rounded-lg object-cover sm:w-40" /> : null}
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium">{proposal.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{proposal.channel}{proposal.durationMs ? ` · ${length(proposal.durationMs)}` : ""}</p>
        </div>
      </div>
      <div className="space-y-2 border-t border-border p-3">
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
          I own this video or have permission to clip it
        </label>
        <Button size="sm" className="min-h-10 w-full sm:w-auto" disabled={!owned || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}
          Clip this video
        </Button>
      </div>
    </div>
  );
}
