import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ArchiveRestore, ArrowLeft, Forward, Link2, Loader2, MailOpen, Paperclip, Reply, ReplyAll, Search, Unlink, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { initials } from "@/lib/campaign-templates";
import { emailFrameDocument } from "@/lib/email-inbox";
import { findInboxLeads, getInboxThread, updateInboxThread } from "@/lib/email-inbox.functions";
import { formatBytes, type ComposeRequest } from "@/components/campaigns/InboxComposer";

type Thread = Awaited<ReturnType<typeof getInboxThread>>;
type Message = Thread["messages"][number];

/** One email conversation: every message, its files, and reply / reply all / forward. */
export function MailThread({ threadId, onBack, onCompose }: { threadId: string; onBack: () => void; onCompose: (request: ComposeRequest) => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getInboxThread);
  const update = useServerFn(updateInboxThread);
  const q = useQuery({ queryKey: ["email-inbox-thread", threadId], queryFn: () => load({ data: { threadId } }) });
  useEffect(() => {
    if (q.isSuccess) {
      // Opening marks it read: refresh the list and the sidebar badge.
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
      void qc.invalidateQueries({ queryKey: ["email-replies"] });
      void qc.invalidateQueries({ queryKey: ["nav-counts"] });
    }
  }, [q.isSuccess, qc]);
  const change = useMutation({
    mutationFn: (patch: { read?: boolean; archived?: boolean; leadId?: string | null }) => update({ data: { threadId, ...patch } }),
    onSuccess: (_r, patch) => {
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
      void qc.invalidateQueries({ queryKey: ["nav-counts"] });
      if (patch.archived !== undefined) toast.success(patch.archived ? "Archived." : "Moved back to the inbox.");
      if (patch.read === false) { toast.success("Marked unread."); onBack(); return; }
      if (patch.archived) { onBack(); return; }
      void qc.invalidateQueries({ queryKey: ["email-inbox-thread", threadId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That didn't work."),
  });

  if (q.isLoading) return <div className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="p-6 text-sm text-destructive">That conversation couldn't be loaded.</p>;
  const t = q.data;
  const last = t.messages[t.messages.length - 1];
  const iconButton = "grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground";

  return (
    <div className="flex h-full flex-col max-md:min-h-[calc(100dvh-3.5rem)] md:min-h-[32rem]">
      <div className="sticky top-14 z-10 flex items-center gap-1 border-b border-white/60 bg-white/70 px-2 py-2 backdrop-blur-xl md:static md:bg-transparent md:px-4 md:py-3 md:backdrop-blur-none">
        <button type="button" onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/70 md:hidden" aria-label="Back to inbox">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate text-sm font-semibold">{t.subject}</h2>
          <p className="truncate text-xs text-muted-foreground">{t.participants.join(", ") || "—"}</p>
        </div>
        <LeadLink lead={t.lead} busy={change.isPending} onLink={(leadId) => change.mutate({ leadId })} />
        <button type="button" className={iconButton} title="Mark unread" aria-label="Mark unread" onClick={() => change.mutate({ read: false })}>
          <MailOpen className="size-4" />
        </button>
        <button type="button" className={iconButton} title={t.archived ? "Move to inbox" : "Archive"} aria-label={t.archived ? "Move to inbox" : "Archive"} onClick={() => change.mutate({ archived: !t.archived })}>
          {t.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </button>
      </div>
      <div className="flex-1 space-y-2.5 p-2.5 sm:p-4 md:overflow-y-auto">
        {t.messages.map((m, i) => (
          <MessageCard key={m.id} message={m} startOpen={i === t.messages.length - 1 || !m.read} onCompose={(mode) => onCompose({ mode, threadId, messageId: m.id })} />
        ))}
      </div>
      {last && (
        <div className="sticky bottom-0 z-10 flex gap-2 border-t border-white/60 bg-white/75 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:static md:bg-transparent md:p-3 md:backdrop-blur-none">
          <Button className="btn-glow h-11 flex-1 sm:flex-none" onClick={() => onCompose({ mode: "reply", threadId, messageId: last.id })}><Reply /> Reply</Button>
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => onCompose({ mode: "reply_all", threadId, messageId: last.id })}><ReplyAll /> Reply all</Button>
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => onCompose({ mode: "forward", threadId, messageId: last.id })}><Forward /> Forward</Button>
        </div>
      )}
    </div>
  );
}

function MessageCard({ message: m, startOpen, onCompose }: { message: Message; startOpen: boolean; onCompose: (mode: "reply" | "reply_all" | "forward") => void }) {
  const [open, setOpen] = useState(startOpen);
  const name = m.direction === "out" ? `You (${m.fromName ?? m.fromEmail})` : (m.fromName ?? m.fromEmail);
  return (
    <article className={cn("rounded-2xl border border-white/80 shadow-sm", m.direction === "out" ? "bg-primary/[0.06]" : "bg-white/90")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full min-w-0 items-start gap-3 p-3 text-left" aria-expanded={open}>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white", m.direction === "out" ? "bg-[var(--primary-deep)]" : "bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)]")}>
          {initials(m.fromName, m.fromEmail)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", !m.read ? "font-semibold" : "font-medium")}>{name}</span>
            <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString("en-AU")}>{relativeTime(m.createdAt)}</time>
          </span>
          {open ? (
            <span className="block truncate text-xs text-muted-foreground">
              to {m.to.join(", ")}{m.cc.length ? ` · cc ${m.cc.join(", ")}` : ""}{m.bcc.length ? ` · bcc ${m.bcc.join(", ")}` : ""}
              {m.status === "failed" ? " · failed" : ""}
            </span>
          ) : (
            <span className="block truncate text-xs text-muted-foreground">{m.bodyText.replace(/\s+/g, " ").slice(0, 160)}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {m.bodyHtml ? <EmailFrame html={m.bodyHtml} /> : <p className="whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">{m.bodyText || "(no text)"}</p>}
          {m.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
              {m.attachments.map((a) => (
                <li key={a.path} className="max-w-full">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-2.5 py-1.5 text-xs hover:bg-white">
                      <Paperclip className="size-3 shrink-0" /> <span className="min-w-0 truncate">{a.name}</span> <span className="shrink-0 text-muted-foreground">{formatBytes(a.size)}</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs text-muted-foreground"><Paperclip className="size-3" /> {a.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="h-9" onClick={() => onCompose("reply")}><Reply /> Reply</Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => onCompose("reply_all")}><ReplyAll /> Reply all</Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => onCompose("forward")}><Forward /> Forward</Button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * A received email's own HTML, in a sandboxed frame: scripts never run, links
 * open in a new tab, and it is sized to its content.
 */
function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 60), 6000));
  };
  return (
    <iframe
      ref={ref}
      title="Email"
      // No allow-scripts: nothing in the email can run. Same origin only lets us measure its height.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={emailFrameDocument(html)}
      onLoad={() => { fit(); window.setTimeout(fit, 400); }}
      style={{ height }}
      className="w-full rounded-xl border border-white/70 bg-white"
    />
  );
}

/** Link the conversation to a customer (lead), or open the one it's linked to. */
function LeadLink({ lead, busy, onLink }: { lead: Thread["lead"]; busy: boolean; onLink: (leadId: string | null) => void }) {
  const find = useServerFn(findInboxLeads);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const results = useQuery({ queryKey: ["inbox-lead-search", q], enabled: open, queryFn: () => find({ data: { q } }), placeholderData: (prev) => prev });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={busy} className={cn("inline-flex h-10 max-w-[10rem] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-white/70", lead ? "text-primary" : "text-muted-foreground")}>
          {lead ? <UserRound className="size-4 shrink-0" /> : <Link2 className="size-4 shrink-0" />}
          <span className="truncate max-sm:sr-only">{lead ? (lead.name ?? lead.email ?? "Customer") : "Link customer"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        {lead && (
          <div className="mb-2 flex items-center gap-1 border-b border-white/70 pb-2">
            <Link to="/leads/$leadId" params={{ leadId: lead.id }} className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm font-medium text-primary hover:bg-white/70">
              Open {lead.name ?? "customer"}
            </Link>
            <button type="button" onClick={() => { onLink(null); setOpen(false); }} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-white/70">
              <Unlink className="size-3.5" /> Unlink
            </button>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer" className="h-9 pl-8 text-base md:text-sm" autoFocus />
        </div>
        <ul className="mt-1 max-h-60 overflow-y-auto">
          {(results.data ?? []).map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => { onLink(l.id); setOpen(false); }} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/70">
                <span className="block truncate text-sm">{l.name ?? "Unnamed"}</span>
                <span className="block truncate text-xs text-muted-foreground">{l.email ?? "No email"}</span>
              </button>
            </li>
          ))}
          {results.data && results.data.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No customers found.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
