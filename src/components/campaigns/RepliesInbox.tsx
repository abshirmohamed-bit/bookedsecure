import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Inbox, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { initials } from "@/lib/campaign-templates";
import { getEmailReplyThread, getEmailReplyThreads, sendEmailReply } from "@/lib/email-replies.functions";

/** Customer replies to campaign emails: conversations on the left, the open one on the right. */
export function RepliesInbox({ thread, onOpen }: { thread: string | null; onOpen: (recipientId: string | null) => void }) {
  const listThreads = useServerFn(getEmailReplyThreads);
  const threads = useQuery({ queryKey: ["email-replies"], queryFn: () => listThreads(), refetchInterval: 60_000 });
  const list = threads.data?.threads ?? [];

  if (threads.isLoading) {
    return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/50" />)}</div>;
  }
  if (threads.isError) return <p className="p-6 text-center text-sm text-destructive">Replies couldn't be loaded.</p>;
  if (threads.data?.setupMissing) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Replies are waiting for a database update (migration 0033_email_replies).</p>;
  }

  return (
    <div className="grid min-h-[28rem] md:grid-cols-[18rem_minmax(0,1fr)]">
      <ul className={cn("divide-y divide-white/60 border-white/60 md:border-r", thread && "hidden md:block")} aria-label="Conversations">
        {list.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/75 text-primary shadow-[inset_0_1px_0_white]"><Inbox className="size-5" /></span>
            <p className="text-sm font-medium">No replies yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {threads.data?.enabled
                ? "When a customer replies to a campaign email, the conversation shows up here."
                : "Replies will show here once email receiving is switched on. Until then they go to your own inbox."}
            </p>
          </li>
        )}
        {list.map((t) => (
          <li key={t.recipientId}>
            <button
              type="button"
              onClick={() => onOpen(t.recipientId)}
              className={cn("flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/50", thread === t.recipientId && "bg-white/70")}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-[11px] font-semibold text-white">
                {initials(t.customerName, t.customerEmail)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-sm", t.unread ? "font-semibold" : "font-medium text-foreground/80")}>{t.customerName ?? t.customerEmail}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(t.lastAt)}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{t.lastFromCustomer ? "" : "You: "}{t.lastMessage}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Mail className="size-3" /> <span className="truncate">{t.campaignName ?? "Campaign"}</span>
                  {t.unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">{t.unread}</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className={cn("min-w-0", !thread && "hidden md:block")}>
        {thread ? <Thread recipientId={thread} onBack={() => onOpen(null)} /> : (
          <div className="hidden h-full items-center justify-center p-8 text-sm text-muted-foreground md:flex">Choose a conversation to read and reply.</div>
        )}
      </div>
    </div>
  );
}

function Thread({ recipientId, onBack }: { recipientId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getEmailReplyThread);
  const send = useServerFn(sendEmailReply);
  const q = useQuery({ queryKey: ["email-reply-thread", recipientId], queryFn: () => load({ data: { recipientId } }) });
  const [text, setText] = useState("");
  useEffect(() => setText(""), [recipientId]);
  useEffect(() => {
    if (q.isSuccess) {
      void qc.invalidateQueries({ queryKey: ["email-replies"] });
      void qc.invalidateQueries({ queryKey: ["nav-counts"] });
    }
  }, [q.isSuccess, qc]);
  const reply = useMutation({
    mutationFn: () => send({ data: { recipientId, bodyText: text } }),
    onSuccess: (result) => {
      if ("duplicate" in result && result.duplicate) toast.info("That reply was already sent.");
      else toast.success("Reply sent.");
      setText("");
      void qc.invalidateQueries({ queryKey: ["email-reply-thread", recipientId] });
      void qc.invalidateQueries({ queryKey: ["email-replies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The reply could not be sent."),
  });

  if (q.isLoading) return <div className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="p-6 text-sm text-destructive">That conversation couldn't be loaded.</p>;
  const t = q.data;

  return (
    <div className="flex h-full min-h-[28rem] flex-col">
      <div className="flex items-center gap-2 border-b border-white/60 px-4 py-3">
        <button type="button" onClick={onBack} className="grid size-8 place-items-center rounded-full hover:bg-white/70 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t.customerName ?? t.customerEmail}</p>
          <p className="truncate text-xs text-muted-foreground">{t.customerEmail}{t.campaign ? ` · ${t.campaign.name}` : ""}</p>
        </div>
        {t.leadId && (
          <Link to="/leads/$leadId" params={{ leadId: t.leadId }} className="text-xs font-medium text-primary hover:underline">Open lead</Link>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {t.campaign && (
          <div className="rounded-2xl border border-white/70 bg-white/45 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">You sent: {t.campaign.subject}</p>
            <p className="mt-1 line-clamp-3 whitespace-pre-line">{t.campaign.bodyText}</p>
          </div>
        )}
        {t.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm", m.direction === "out" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-white/80 bg-white/90")}>
              <p className="whitespace-pre-line break-words [overflow-wrap:anywhere]">{m.body_text || "(no text)"}</p>
              <p className={cn("mt-1 text-[10px]", m.direction === "out" ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {m.direction === "out" ? "You" : (m.from_name ?? m.from_email)} · {relativeTime(m.created_at)}{m.status === "failed" ? " · failed" : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form
        className="space-y-2 border-t border-white/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) reply.mutate();
        }}
      >
        <Textarea rows={3} maxLength={10000} placeholder={`Reply to ${t.customerName ?? t.customerEmail}…`} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Sent by email from your business name. Their next reply comes back here.</p>
          <Button type="submit" size="sm" disabled={!text.trim() || reply.isPending}>
            {reply.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send reply
          </Button>
        </div>
      </form>
    </div>
  );
}
