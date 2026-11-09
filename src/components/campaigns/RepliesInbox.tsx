import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Inbox, Loader2, Mail, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { initials } from "@/lib/campaign-templates";
import { getEmailReplyThread, sendEmailReply } from "@/lib/email-replies.functions";
import { useReplyThreads } from "@/components/campaigns/CampaignsTabs";

/**
 * Customer replies to campaign emails: conversations on the left, the open one
 * on the right. On a phone it is one or the other, like a messaging app.
 * `campaign` narrows the list to the replies to one campaign.
 */
export function RepliesInbox({
  thread,
  campaign,
  onOpen,
  onClearCampaign,
}: {
  thread: string | null;
  campaign?: string | null;
  onOpen: (recipientId: string | null) => void;
  onClearCampaign?: () => void;
}) {
  const threads = useReplyThreads();
  const all = threads.data?.threads ?? [];
  const list = campaign ? all.filter((t) => t.campaignId === campaign) : all;
  const campaignName = campaign ? (all.find((t) => t.campaignId === campaign)?.campaignName ?? "this campaign") : null;

  if (threads.isLoading) {
    return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/50" />)}</div>;
  }
  if (threads.isError) return <p className="p-6 text-center text-sm text-destructive">Replies couldn't be loaded.</p>;
  if (threads.data?.setupMissing) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Replies are waiting for a database update (migration 0033_email_replies).</p>;
  }

  return (
    <div className="grid grid-cols-1 md:min-h-[28rem] md:grid-cols-[18rem_minmax(0,1fr)]">
      <ul className={cn("min-w-0 divide-y divide-white/60 border-white/60 md:border-r", thread && "hidden md:block")} aria-label="Conversations">
        {campaignName && (
          <li className="flex items-center gap-2 bg-white/35 px-4 py-2 text-xs">
            <Mail className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              Replies to <span className="font-medium">{campaignName}</span>
            </span>
            {onClearCampaign && (
              <button type="button" onClick={onClearCampaign} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-primary hover:bg-white/60">
                <X className="size-3" /> All replies
              </button>
            )}
          </li>
        )}
        {list.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/75 text-primary shadow-[inset_0_1px_0_white]"><Inbox className="size-5" /></span>
            <p className="text-sm font-medium">{campaignName ? "No replies to this campaign yet" : "No replies yet"}</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {threads.data?.enabled
                ? "When a customer replies to a campaign email, the conversation shows up here."
                : "Replies will show here once email receiving is switched on. Until then they go to your own inbox."}
            </p>
          </li>
        )}
        {list.map((t) => (
          <li key={t.recipientId} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(t.recipientId)}
              className={cn(
                "flex w-full min-w-0 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/50 active:bg-white/60",
                thread === t.recipientId && "bg-white/70",
              )}
            >
              <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-xs font-semibold text-white">
                {initials(t.customerName, t.customerEmail)}
                {t.unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-white bg-primary" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-sm", t.unread ? "font-semibold" : "font-medium text-foreground/80")}>{t.customerName ?? t.customerEmail}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(t.lastAt)}</span>
                </span>
                <span className={cn("block truncate text-xs", t.unread ? "text-foreground/85" : "text-muted-foreground")}>
                  {t.lastFromCustomer ? "" : "You: "}
                  {t.lastMessage}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Mail className="size-3 shrink-0" /> <span className="min-w-0 truncate">{t.campaignName ?? "Campaign"}</span>
                  {t.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">{t.unread} new</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className={cn("min-w-0", !thread && "hidden md:block")}>
        {thread ? (
          <Thread recipientId={thread} onBack={() => onOpen(null)} />
        ) : (
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
      // Opening a thread marks it read: refresh the list, the switcher, the sidebar badge and campaign counts.
      void qc.invalidateQueries({ queryKey: ["email-replies"] });
      void qc.invalidateQueries({ queryKey: ["nav-counts"] });
      void qc.invalidateQueries({ queryKey: ["email-campaign"] });
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
    <div className="flex h-full flex-col md:min-h-[28rem]">
      {/* On a phone the header sticks under the app bar and the composer sticks to the bottom. */}
      <div className="sticky top-14 z-10 flex items-center gap-2 border-b border-white/60 bg-white/70 px-2 py-2 backdrop-blur-xl md:static md:bg-transparent md:px-4 md:py-3 md:backdrop-blur-none">
        <button type="button" onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/70 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t.customerName ?? t.customerEmail}</p>
          <p className="truncate text-xs text-muted-foreground">{t.customerEmail}</p>
        </div>
        {t.leadId && (
          <Link to="/leads/$leadId" params={{ leadId: t.leadId }} className="shrink-0 rounded-full px-3 py-2 text-xs font-medium text-primary hover:bg-white/70">
            Open lead
          </Link>
        )}
      </div>
      <div className="flex-1 space-y-3 p-3 sm:p-4 md:overflow-y-auto">
        {t.campaign && (
          <details className="group rounded-2xl border border-white/70 bg-white/45 p-3 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <Mail className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">You sent: {t.campaign.subject}</span>
              <span className="shrink-0 text-[11px] font-normal text-primary group-open:hidden">Show</span>
              <span className="hidden shrink-0 text-[11px] font-normal text-primary group-open:inline">Hide</span>
            </summary>
            <p className="mt-2 whitespace-pre-line">{t.campaign.bodyText}</p>
            <Link to="/campaigns/$campaignId" params={{ campaignId: t.campaign.id }} className="mt-2 inline-block font-medium text-primary hover:underline">
              Open campaign · {t.campaign.name}
            </Link>
          </details>
        )}
        {t.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                m.direction === "out" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-white/80 bg-white/90",
              )}
            >
              <p className="whitespace-pre-line break-words [overflow-wrap:anywhere]">{m.body_text || "(no text)"}</p>
              <p className={cn("mt-1 text-[10px]", m.direction === "out" ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {m.direction === "out" ? "You" : (m.from_name ?? m.from_email)} · {relativeTime(m.created_at)}
                {m.status === "failed" ? " · failed" : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form
        className="sticky bottom-0 z-10 space-y-1.5 border-t border-white/60 bg-white/75 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:static md:space-y-2 md:bg-transparent md:p-3 md:backdrop-blur-none"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) reply.mutate();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            maxLength={10000}
            placeholder={`Reply to ${t.customerName ?? t.customerEmail}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="max-h-40 min-h-11 flex-1 resize-none text-base md:text-sm"
            aria-label="Your reply"
          />
          <Button type="submit" disabled={!text.trim() || reply.isPending} className="h-11 shrink-0 max-md:w-11 max-md:px-0" aria-label="Send reply">
            {reply.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="max-md:sr-only">Send reply</span>
          </Button>
        </div>
        <p className="px-0.5 text-[11px] text-muted-foreground">Emailed from your business name. Their next reply comes back here.</p>
      </form>
    </div>
  );
}
