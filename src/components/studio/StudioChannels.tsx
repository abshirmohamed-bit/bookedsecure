import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Facebook, Instagram, Linkedin, Loader2, Youtube, type LucideIcon } from "lucide-react";
import { YouTubeInsights } from "@/components/social/YouTubeInsights";
import { Button } from "@/components/ui/button";
import { getYouTube } from "@/lib/youtube.functions";

const CHANNELS: { id: string; label: string; icon: LucideIcon; color: string; live: boolean }[] = [
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-[#ff0000]", live: true },
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-[#1877f2]", live: false },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-[#d62976]", live: false },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-[#0a66c2]", live: false },
];

/** Studio's channel analytics. YouTube is live; the others are laid out for later. */
export function StudioChannels() {
  const load = useServerFn(getYouTube);
  const youtube = useQuery({ queryKey: ["youtube"], queryFn: () => load() });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {CHANNELS.map((c) => (
          <div key={c.id} aria-current={c.live ? "true" : undefined} className={`glass flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 ${c.live ? "ring-2 ring-primary/40" : "opacity-70"}`}>
            <c.icon className={`size-5 shrink-0 ${c.color}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{c.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{c.live ? (youtube.data?.connected ? "Connected" : "Not connected") : "Analytics coming soon"}</span>
            </span>
          </div>
        ))}
      </div>

      {youtube.isLoading ? <div className="glass grid place-items-center rounded-2xl p-10"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading YouTube" /></div> : null}
      {youtube.isError ? <div className="glass rounded-2xl p-6 text-sm text-destructive">YouTube couldn't be loaded. Refresh to try again.</div> : null}
      {youtube.data && !youtube.data.connected ? (
        <div className="glass grid place-items-center gap-3 rounded-3xl p-10 text-center">
          <Youtube className="size-8 text-[#ff0000]" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Connect your YouTube channel to see views, watch time, and what's working.</p>
          <Button asChild className="min-h-11"><Link to="/social" search={{ platform: "youtube" }}>Connect YouTube</Link></Button>
        </div>
      ) : null}
      {youtube.data?.connected ? <YouTubeInsights isOwner={youtube.data.isOwner} /> : null}
    </div>
  );
}
