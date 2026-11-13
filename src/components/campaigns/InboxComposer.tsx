import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { attachmentProblem, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, type StoredAttachment } from "@/lib/email-inbox";
import { findInboxLeads, getInboxDraft, sendInboxEmail, uploadInboxAttachment } from "@/lib/email-inbox.functions";

export type ComposeRequest =
  | { mode: "new"; leadId?: string | null }
  | { mode: "reply" | "reply_all" | "forward"; threadId: string; messageId?: string | null };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const TITLES = { new: "New email", reply: "Reply", reply_all: "Reply all", forward: "Forward" } as const;

/**
 * Writing an email from the business's own address: a new one, a reply,
 * a reply to everyone or a forward. Full screen on a phone.
 */
export function InboxComposer({ request, from, onClose, onSent }: {
  request: ComposeRequest | null;
  from: string | null;
  onClose: () => void;
  onSent: (threadId: string) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 p-4 sm:max-w-2xl sm:p-5 max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none max-sm:pt-[max(1rem,env(safe-area-inset-top))]">
        {request && <ComposerBody key={JSON.stringify(request)} request={request} from={from} onClose={onClose} onSent={onSent} />}
      </DialogContent>
    </Dialog>
  );
}

function ComposerBody({ request, from, onClose, onSent }: { request: ComposeRequest; from: string | null; onClose: () => void; onSent: (threadId: string) => void }) {
  const qc = useQueryClient();
  const loadDraft = useServerFn(getInboxDraft);
  const findLeads = useServerFn(findInboxLeads);
  const upload = useServerFn(uploadInboxAttachment);
  const send = useServerFn(sendInboxEmail);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<StoredAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const leadId = request.mode === "new" ? (request.leadId ?? null) : null;

  const draft = useQuery({
    queryKey: ["inbox-draft", request],
    enabled: request.mode !== "new",
    queryFn: () => loadDraft({ data: { threadId: (request as { threadId: string }).threadId, messageId: (request as { messageId?: string | null }).messageId ?? null, mode: request.mode as "reply" | "reply_all" | "forward" } }),
    staleTime: Infinity,
  });
  const lead = useQuery({
    queryKey: ["inbox-lead", leadId],
    enabled: Boolean(leadId),
    queryFn: () => findLeads({ data: { q: "", leadId } }),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!draft.data) return;
    setTo(draft.data.to.join(", "));
    setCc(draft.data.cc.join(", "));
    setShowCc(draft.data.cc.length > 0);
    setSubject(draft.data.subject);
  }, [draft.data]);
  useEffect(() => {
    const email = lead.data?.[0]?.email;
    if (email) setTo((current) => current || email);
  }, [lead.data]);

  const original = request.mode === "forward" ? (draft.data?.attachments ?? []) : [];
  const total = [...files, ...original].reduce((n, f) => n + f.size, 0);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      const problem = attachmentProblem(file.name, file.size);
      if (problem) { toast.error(problem); continue; }
      if (files.length + original.length + uploading >= MAX_ATTACHMENTS) { toast.error(`Attach at most ${MAX_ATTACHMENTS} files.`); break; }
      if (total + file.size > MAX_TOTAL_ATTACHMENT_BYTES) { toast.error("Attachments must be 20 MB or less in total."); break; }
      setUploading((n) => n + 1);
      try {
        const stored = await upload({ data: { name: file.name, type: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) } });
        setFiles((current) => [...current, stored]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `${file.name} could not be attached.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const split = (value: string) => value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const mutation = useMutation({
    mutationFn: () => send({
      data: {
        mode: request.mode,
        threadId: request.mode === "new" ? null : request.threadId,
        messageId: request.mode === "new" ? null : (request.messageId ?? null),
        to: split(to),
        cc: split(cc),
        bcc: split(bcc),
        subject,
        bodyText: body,
        attachments: files,
        includeOriginalAttachments: true,
        leadId,
      },
    }),
    onSuccess: (result) => {
      if (result.duplicate) toast.info("That email was already sent.");
      else toast.success("Email sent.");
      void qc.invalidateQueries({ queryKey: ["email-inbox"] });
      void qc.invalidateQueries({ queryKey: ["email-inbox-thread", result.threadId] });
      onSent(result.threadId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The email could not be sent."),
  });

  const ready = split(to).length > 0 && subject.trim().length > 0 && body.trim().length > 0 && uploading === 0 && !mutation.isPending;
  const field = "flex items-center gap-2 border-b border-white/70 py-1.5";
  const label = "w-14 shrink-0 text-xs font-medium text-muted-foreground";

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) mutation.mutate();
      }}
    >
      <div className="pr-8">
        <DialogTitle className="text-base">{TITLES[request.mode]}</DialogTitle>
        <DialogDescription className="truncate text-xs">{from ? `From ${from}` : "From your business address"}</DialogDescription>
      </div>
      {draft.isLoading ? (
        <div className="grid flex-1 place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <div className={field}>
            <label htmlFor="compose-to" className={label}>To</label>
            <Input id="compose-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" inputMode="email" autoComplete="off" className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm" />
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-primary hover:bg-white/60">Cc/Bcc</button>
            )}
          </div>
          {showCc && (
            <>
              <div className={field}>
                <label htmlFor="compose-cc" className={label}>Cc</label>
                <Input id="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} inputMode="email" autoComplete="off" className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm" />
              </div>
              <div className={field}>
                <label htmlFor="compose-bcc" className={label}>Bcc</label>
                <Input id="compose-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} inputMode="email" autoComplete="off" className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm" />
              </div>
            </>
          )}
          <div className={field}>
            <label htmlFor="compose-subject" className={label}>Subject</label>
            <Input id="compose-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm" />
          </div>
          <Textarea
            aria-label="Message"
            value={body}
            maxLength={20000}
            autoFocus={request.mode !== "new"}
            onChange={(e) => setBody(e.target.value)}
            placeholder={request.mode === "forward" ? "Add a note (the original email is included below it)…" : "Write your email…"}
            className="mt-2 min-h-48 flex-1 resize-none bg-white/60 text-base md:text-sm"
          />
          {(files.length > 0 || original.length > 0 || uploading > 0) && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
              {original.map((f) => (
                <li key={f.path} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-2.5 py-1 text-xs">
                  <Paperclip className="size-3 shrink-0" /> <span className="min-w-0 truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)} · original</span>
                </li>
              ))}
              {files.map((f) => (
                <li key={f.path} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-xs">
                  <Paperclip className="size-3 shrink-0" /> <span className="min-w-0 truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" onClick={() => setFiles((c) => c.filter((x) => x.path !== f.path))} className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-white" aria-label={`Remove ${f.name}`}>
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              {uploading > 0 && (
                <li className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-2.5 py-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Attaching…
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 pb-[env(safe-area-inset-bottom)]">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <Button type="button" variant="ghost" className="h-11" onClick={() => fileInput.current?.click()}>
          <Paperclip /> <span className="max-sm:sr-only">Attach</span>
        </Button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">Sent with your business email design.</span>
        <Button type="button" variant="ghost" className="h-11" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!ready} className="btn-glow h-11">
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send
        </Button>
      </div>
    </form>
  );
}
