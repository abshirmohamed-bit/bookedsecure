import { ArrowRight, Eraser, Globe2, History, MessageSquarePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type CoworkThread = { id: string; title: string; isDefault: boolean; updatedAt: string };

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * Co-Work's conversation history as a compact dropdown in the page's top-right
 * corner (radix portals it to body, so glass parents don't trap it).
 */
export function CoworkHistory({
  threads,
  activeId,
  canClear,
  busy,
  onSelect,
  onCreate,
  onClear,
  onDelete,
  onWebsiteSetup,
}: {
  threads: CoworkThread[];
  activeId: string;
  canClear: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClear: () => void;
  onDelete: (id: string) => void;
  onWebsiteSetup?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const keepOpen = (e: Event) => { if (confirming) e.preventDefault(); };
  const close = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Conversation history" title="Conversation history" className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground data-[state=open]:bg-white/70 data-[state=open]:text-foreground">
          <History className="size-[18px]" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} onInteractOutside={keepOpen} onFocusOutside={keepOpen} className="z-[70] flex max-h-[min(70dvh,32rem)] w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/70 bg-popover p-0 shadow-[inset_0_1px_0_white,0_24px_60px_-20px_oklch(0.25_0.1_258/0.45)]">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
          <p className="text-sm font-semibold">Conversations</p>
          <ConfirmAction title="Clear this chat?" description="Every message in this conversation will be removed." confirmLabel="Clear" onOpenChange={setConfirming} onConfirm={() => { setOpen(false); onClear(); }}>
            <button
              type="button"
              title="Clear this chat"
              aria-label="Clear this chat"
              disabled={!canClear || busy}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-white/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Eraser className="size-3.5" aria-hidden="true" /> Clear
            </button>
          </ConfirmAction>
        </div>
        <div className="shrink-0 px-2 pb-2">
          <button type="button" disabled={busy} onClick={close(onCreate)} className="flex min-h-10 w-full items-center gap-2 rounded-xl bg-white/70 px-3 text-sm font-medium text-primary shadow-sm hover:bg-white disabled:opacity-50">
            <MessageSquarePlus className="size-4" aria-hidden="true" /> New conversation
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain border-t border-white/70 px-2 py-2">
          {threads.map((thread) => {
            const active = thread.id === activeId;
            return (
              <li key={thread.id} className={`group flex items-center gap-1 rounded-xl ${active ? "bg-primary/10" : "hover:bg-white/70"}`}>
                <button type="button" onClick={close(() => onSelect(thread.id))} aria-current={active ? "true" : undefined} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left">
                  <span className={`size-1.5 shrink-0 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`} aria-hidden="true" />
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-medium text-primary" : "text-foreground/85"}`}>{thread.isDefault ? "Ongoing conversation" : thread.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{when(thread.updatedAt)}</span>
                </button>
                {!thread.isDefault ? (
                  <ConfirmAction title="Delete this conversation?" description={`"${thread.title}" will be deleted.`} onOpenChange={setConfirming} onConfirm={() => onDelete(thread.id)}>
                    <button
                      type="button"
                      aria-label={`Delete ${thread.title}`}
                      className="mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </ConfirmAction>
                ) : null}
              </li>
            );
          })}
        </ul>
        {onWebsiteSetup ? (
          <button type="button" onClick={close(onWebsiteSetup)} className="flex shrink-0 items-center justify-between border-t border-white/70 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-white/60 hover:text-foreground">
            <span className="flex items-center gap-2"><Globe2 className="size-4" aria-hidden="true" /> Set up from website</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
