import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getEngineState } from "@/lib/video-clips.functions";

const TONES = { on: "bg-[#30d158]", idle: "bg-[#ff9f0a]", off: "bg-[#ff453a]" } as const;

/** Green when the video engine is on, orange when idle, red when off. */
export function EngineDot({ onAsk }: { onAsk: (text: string) => void }) {
  const stateFn = useServerFn(getEngineState);
  const q = useQuery({ queryKey: ["engine-state"], queryFn: () => stateFn(), refetchInterval: 30_000 });
  const [open, setOpen] = useState(false);
  if (!q.data && !q.isError) return null;
  const { state, label, detail, canControl } = q.data ?? { state: "off" as const, label: "Unknown", detail: "The engine's status couldn't be checked.", canControl: false };
  const ask = (text: string) => { setOpen(false); onAsk(text); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Video engine: ${label}`} title={`Video engine: ${label}`} className="grid size-11 place-items-center rounded-full hover:bg-white/50 lg:size-8">
          <span className={`block size-2.5 rounded-full ring-2 ring-white/70 ${TONES[state]}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-2xl bg-white p-3 shadow-xl">
        <p className="flex items-center gap-2 text-sm font-medium"><span className={`size-2.5 rounded-full ${TONES[state]}`} />Video engine: {label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        {canControl ? (
          <div className="mt-2 flex gap-1.5">
            {state === "on" ? (
              <Button size="sm" variant="outline" className="min-h-10 flex-1 text-xs" onClick={() => ask("Put the video engine to sleep.")}>Put to sleep</Button>
            ) : (
              <Button size="sm" className="min-h-10 flex-1 text-xs" onClick={() => ask("Start the video engine.")}>Start</Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10 flex-1 text-xs" onClick={() => ask("How is the video engine doing? Include anything in progress.")}>Ask Co-Work</Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
