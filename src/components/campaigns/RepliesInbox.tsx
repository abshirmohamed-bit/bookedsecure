import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, AtSign, Inbox, Loader2, Mail, Paperclip, PenSquare, Search, Send, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { initials } from "@/lib/campaign-templates";
import { getEmailReplyThread, sendEmailReply } from "@/lib/email-replies.functions";
import { getInboxList, getInboxMailbox, saveInboxMailbox } from "@/lib/email-inbox.functions";
import { INBOX_DOMAIN, INBOX_FOLDERS, localPartProblem, normaliseLocalPart, type InboxFolder } from "@/lib/email-inbox";
import { InboxComposer, type ComposeRequest } from "@/components/campaigns/InboxComposer";
import { MailThread } from "@/components/campaigns/MailThread";

export type InboxSearch = { thread?: string; conversation?: string; campaign?: string; folder?: InboxFolder; compose?: string };

export function useInboxMailbox() {
  const load = useServerFn(getInboxMailbox);
  return useQuery({ queryKey: ["email-inbox", "mailbox"], queryFn: () => load(), staleTime: 60_000 });
}

/**
 * The business's email: its own address <name>@bookedsecure.com (new mail,
 * sent mail, replies, forwards, attachments) and the replies to campaign
 * emails, in one list. The open conversation sits on the right; on a phone
 * it is one or the other, like a mail app. `campaign` narrows the list to the
 * replies to one campaign.
 */
export function RepliesInbox({ search, go }: { search: InboxSearch; go: (next: InboxSearch, replace: boolean) => void }) {
  const { thread, conversation, campaign } = search;
  const folder: InboxFolder = campaign ? "campaigns" : (search.folder ?? "inbox");
  const open = Boolean(thread || conversation);
  const mailbox = useInboxMailbox();
  const loadList = useServerFn(getInboxList);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [compose, setCompose] = useState<ComposeRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);
  // ?compose=new or ?compose=<lead id> (from a lead page) opens the composer once.
  useEffect(() => {
    if (!search.compose) return;
    setCompose({ mode: "new", leadId: search.compose === "new" ? null : search.compose });
    const { compose: _c, ...rest } = search;
    go(rest, true);
  }, [search, go]);

  const list = useQuery({
    queryKey: ["email-inbox", "list", folder, term, unreadOnly, limit],
    queryFn: () => loadList({ data: { folder, q: term || undefined, unreadOnly, limit } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const items = (list.data?.items ?? []).filter((i) => !campaign || i.campaignId === campaign);
  const campaignName = campaign ? (items.find((i) => i.campaignId === campaign)?.campaignName ?? "this campaign") : null;
  const box = mailbox.data;
  const address = box?.mailbox?.address ?? null;
  const openItem = (kind: "mail" | "campaign", id: string | null) => {
    const base: InboxSearch = { ...(campaign ? { campaign } : {}), ...(search.folder ? { folder: search.folder } : {}) };
    // Opening adds a history entry so the phone's back button returns to the list.
    go(id ? { ...base, ...(kind === "mail" ? { conversation: id } : { thread: id }) } : base, id === null);
  };
  const canWrite = Boolean(address);

  return (
    <>
      <div className="grid grid-cols-1 md:min-h-[32rem] md:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={cn("min-w-0 border-white/60 md:border-r", open && "hidden md:block")}>
          <div className="space-y-2 border-b border-white/60 p-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/60" title="Your email address">
                <AtSign className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 truncate">{address ?? (box?.setupMissing ? "Your own address is coming" : "Choose your email address")}</span>
                {box && !box.setupMissing && <Settings2 className="ml-auto size-3.5 shrink-0" />}
              </button>
              <Button size="sm" className="btn-glow h-10 shrink-0" disabled={!canWrite} onClick={() => setCompose({ mode: "new" })} title={canWrite ? "Write an email" : "Choose your email address first"}>
                <PenSquare /> Write
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email" aria-label="Search email" className="h-10 rounded-full bg-white/60 pl-9 pr-9 text-base md:text-sm" />
              {q && (
                <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full hover:bg-white" aria-label="Clear search"><X className="size-3.5" /></button>
              )}
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Folders">
              {INBOX_FOLDERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={folder === f.id}
                  onClick={() => { setLimit(60); go(f.id === "inbox" ? {} : { folder: f.id }, true); }}
                  className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors", folder === f.id ? "bg-white/90 text-foreground shadow-[0_1px_2px_rgb(15_40_90/0.12),inset_0_1px_0_white]" : "text-muted-foreground hover:bg-white/50")}
                >
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly((u) => !u)}
                className={cn("ml-auto shrink-0 rounded-full px-3 py-1.5 text-xs font-medium", unreadOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/50")}
              >
                Unread
              </button>
            </div>
          </div>
          {box && !box.setupMissing && !box.mailbox && <MailboxSetupCard suggested={box.suggested} canEdit={box.canEdit} />}
          <ul className="min-w-0 divide-y divide-white/60" aria-label="Conversations">
            {campaignName && (
              <li className="flex items-center gap-2 bg-white/35 px-4 py-2 text-xs">
                <Mail className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">Replies to <span className="font-medium">{campaignName}</span></span>
                <button type="button" onClick={() => go({}, true)} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-primary hover:bg-white/60">
                  <X className="size-3" /> All email
                </button>
              </li>
            )}
            {list.isLoading && [0, 1, 2].map((i) => <li key={i} className="p-3"><div className="h-14 animate-pulse rounded-xl bg-white/50" /></li>)}
            {list.isError && <li className="p-6 text-center text-sm text-destructive">Your email couldn't be loaded.</li>}
            {list.isSuccess && items.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <span className="grid size-11 place-items-center rounded-2xl bg-white/75 text-primary shadow-[inset_0_1px_0_white]"><Inbox className="size-5" /></span>
                <p className="text-sm font-medium">{term ? "No email matches that search" : folder === "sent" ? "Nothing sent yet" : folder === "archived" ? "Nothing archived" : "No email yet"}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {term ? "Try a name, email address or a word from the message." : address
                    ? `Email sent to ${address} and replies to your campaigns show up here.`
                    : "Replies to your campaign emails show up here. Choose your own address to send and receive any email."}
                </p>
              </li>
            )}
            {items.map((t) => {
              const selected = t.kind === "mail" ? conversation === t.id : thread === t.id;
              return (
                <li key={t.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openItem(t.kind, t.id)}
                    className={cn("flex w-full min-w-0 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/50 active:bg-white/60", selected && "bg-white/70")}
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-xs font-semibold text-white">
                      {initials(t.name, t.email ?? "")}
                      {t.unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-white bg-primary" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm", t.unread ? "font-semibold" : "font-medium text-foreground/80")}>
                          {t.name}{t.messages > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">{t.messages}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(t.lastAt)}</span>
                      </span>
                      <span className={cn("block truncate text-xs", t.unread ? "font-medium text-foreground/90" : "text-foreground/75")}>{t.subject}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {t.hasAttachments && <Paperclip className="size-3 shrink-0" aria-label="Has attachments" />}
                        <span className="min-w-0 flex-1 truncate">{t.lastFromThem ? "" : "You: "}{t.snippet}</span>
                        {t.kind === "campaign" && <span className="shrink-0 rounded-full bg-white/70 px-1.5 text-[10px] font-medium text-primary">Campaign</span>}
                        {t.unread > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">{t.unread} new</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {list.data?.more && (
              <li className="p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => Math.min(l + 60, 300))}>Show more</Button>
              </li>
            )}
          </ul>
        </div>
        <div className={cn("min-w-0", !open && "hidden md:block")}>
          {conversation ? (
            <MailThread threadId={conversation} onBack={() => openItem("mail", null)} onCompose={setCompose} />
          ) : thread ? (
            <Thread recipientId={thread} onBack={() => openItem("campaign", null)} />
          ) : (
            <div className="hidden h-full items-center justify-center p-8 text-sm text-muted-foreground md:flex">Choose an email to read and reply.</div>
          )}
        </div>
      </div>
      <InboxComposer
        request={compose}
        from={address}
        onClose={() => setCompose(null)}
        onSent={(threadId) => {
          setCompose(null);
          go({ ...(search.folder ? { folder: search.folder } : {}), conversation: threadId }, false);
        }}
      />
      {box && !box.setupMissing && (
        <MailboxSettings open={settingsOpen} onOpenChange={setSettingsOpen} current={box.mailbox} suggested={box.suggested} businessName={box.businessName} canEdit={box.canEdit} />
      )}
      {box?.setupMissing && settingsOpen && (
        <Dialog open onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogTitle>Your own email address</DialogTitle>
            <DialogDescription>Sending and receiving from your own @{INBOX_DOMAIN} address is waiting for a database update (docs/email-inbox.sql). Replies to campaigns already work.</DialogDescription>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function MailboxSetupCard({ suggested, canEdit }: { suggested: string; canEdit: boolean }) {
  return (
    <div className="m-3 rounded-2xl border border-white/70 bg-white/55 p-3">
      <p className="text-sm font-medium">Get your own email address</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Send and receive email here as you@{INBOX_DOMAIN}. Customers can write to it, and you can forward your old mailbox to it.</p>
      {canEdit ? <MailboxForm suggested={suggested} compact /> : <p className="mt-2 text-xs text-muted-foreground">Ask the business owner to choose it.</p>}
    </div>
  );
}

function MailboxSettings({ open, onOpenChange, current, suggested, businessName, canEdit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: { localPart: string; displayName: string | null; signature: string | null; address: string } | null;
  suggested: string;
  businessName: string;
  canEdit: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Your email address</DialogTitle>
        <DialogDescription>
          {current ? `Email to ${current.address} arrives in this inbox, and what you send comes from it.` : `Choose the address customers see. It ends in @${INBOX_DOMAIN}.`}
        </DialogDescription>
        {canEdit ? (
          <MailboxForm suggested={suggested} current={current} businessName={businessName} onSaved={() => onOpenChange(false)} />
        ) : (
          <p className="text-sm text-muted-foreground">Only the business owner can change this.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MailboxForm({ suggested, current, businessName, compact, onSaved }: {
  suggested: string;
  current?: { localPart: string; displayName: string | null; signature: string | null } | null;
  businessName?: string;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveInboxMailbox);
  const [local, setLocal] = useState(current?.localPart ?? suggested);
  const [displayName, setDisplayName] = useState(current?.displayName ?? "");
  const [signature, setSignature] = useState(current?.signature ?? "");
  const normal = normaliseLocalPart(local);
  const problem = normal ? localPartProblem(normal) : "Choose a name.";
  const changingAddress = Boolean(current && current.localPart !== normal);
  const mutation = useMutation({
    mutationFn: () => save({ data: { localPart: normal, displayName: displayName || null, signature: signature || null } }),
    onSuccess: (saved) => {
      toast.success(`Your address is ${saved.address}.`);
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Your address could not be saved."),
  });
  return (
    <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!problem) mutation.mutate(); }}>
      <div>
        <div className="flex items-center gap-1 rounded-xl border border-input bg-white/70 pr-3 focus-within:ring-2 focus-within:ring-ring">
          <Input value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Address name" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-10 flex-1 border-0 bg-transparent text-base shadow-none focus-visible:ring-0 md:text-sm" />
          <span className="shrink-0 text-sm text-muted-foreground">@{INBOX_DOMAIN}</span>
        </div>
        {local && problem ? <p className="mt-1 text-xs text-destructive">{problem}</p> : normal !== local.trim().toLowerCase() && normal ? <p className="mt-1 text-xs text-muted-foreground">Will be {normal}@{INBOX_DOMAIN}</p> : null}
        {changingAddress && <p className="mt-1 text-xs text-amber-700">Email to {current!.localPart}@{INBOX_DOMAIN} will stop arriving once you change it.</p>}
      </div>
      {!compact && (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Name people see</span>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={businessName || "Your business name"} maxLength={80} className="h-10 text-base md:text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Signature</span>
            <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={3} maxLength={1000} placeholder={"Thanks,\nYour name\n0400 000 000"} className="text-base md:text-sm" />
          </label>
        </>
      )}
      <Button type="submit" className="btn-glow h-10 w-full" disabled={Boolean(problem) || mutation.isPending}>
        {mutation.isPending && <Loader2 className="animate-spin" />} {current ? "Save" : "Use this address"}
      </Button>
    </form>
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
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
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
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The reply could not be sent."),
  });

  if (q.isLoading) return <div className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="p-6 text-sm text-destructive">That conversation couldn't be loaded.</p>;
  const t = q.data;

  return (
    <div className="flex h-full flex-col max-md:min-h-[calc(100dvh-3.5rem)] md:min-h-[28rem]">
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
