import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Mail, MessageSquareText, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/notifications";
import type { GatewayChannel } from "@/lib/cowork-gateway";
import { confirmCoworkGatewayCode, getCoworkGateways, linkCoworkGateway, updateCoworkGateway } from "@/lib/cowork-gateway.functions";

const KEY = ["cowork-gateways"] as const;
type Data = Awaited<ReturnType<typeof getCoworkGateways>>;
type View = Data["gateways"][number];
const errorText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

/**
 * Message Co-Work from anywhere: text the business's number, email a private
 * address, or chat on Telegram. Each person links their own; answers only go
 * back there, and anything that sends or books still waits for Confirm here.
 */
export function CoworkGateways() {
  const [open, setOpen] = useState(false);
  const load = useServerFn(getCoworkGateways);
  const q = useQuery({ queryKey: KEY, queryFn: () => load(), staleTime: 30_000, enabled: open });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Message Co-Work from your phone" title="Message Co-Work from your phone"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground">
        <Smartphone className="size-[18px]" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto">
          <DialogTitle>Message Co-Work from your phone</DialogTitle>
          <DialogDescription>
            Ask Co-Work by text, email or Telegram, the same as here. It reads your records and prepares drafts; anything that sends, posts or books waits for you to tap Confirm in Co-Work. Answers only go back to the phone, address or chat you link.
          </DialogDescription>
          {q.isLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : q.isError || !q.data ? <p className="text-sm text-destructive">This couldn't be loaded.</p>
            : q.data.setupMissing ? <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">This is waiting for a database update (docs/cowork-gateways.sql).</p>
            : <Channels data={q.data} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Channels({ data }: { data: Data }) {
  const find = (c: GatewayChannel) => data.gateways.find((g) => g.channel === c) ?? null;
  return (
    <div className="min-w-0 space-y-3">
      <SmsCard gateway={find("sms")} businessNumber={data.businessNumber} suggested={data.suggestedMobile} />
      <EmailCard gateway={find("email")} loginEmail={data.loginEmail} />
      <TelegramCard gateway={find("telegram")} ready={data.telegramReady} />
    </div>
  );
}

function Card({ icon, title, status, children }: { icon: ReactNode; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/70 bg-white/45 p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{title}</p>{status}</div>
          {children}
        </div>
      </div>
    </section>
  );
}

function Status({ gateway }: { gateway: View | null }) {
  if (!gateway?.verified) return null;
  return gateway.enabled
    ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Connected</span>
    : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Paused</span>;
}

function useGatewayActions(channel: GatewayChannel) {
  const qc = useQueryClient();
  const update = useServerFn(updateCoworkGateway);
  return useMutation({
    mutationFn: (v: { enabled?: boolean; remove?: boolean }) => update({ data: { channel, ...v } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorText(e)),
  });
}

function Manage({ gateway, channel }: { gateway: View; channel: GatewayChannel }) {
  const act = useGatewayActions(channel);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {gateway.lastMessageAt && <span>Last message {relativeTime(gateway.lastMessageAt)}</span>}
      <span className="ml-auto flex gap-1">
        <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ enabled: !gateway.enabled })}>{gateway.enabled ? "Pause" : "Resume"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => { if (window.confirm("Disconnect this?")) act.mutate({ remove: true }); }}>Disconnect</Button>
      </span>
    </div>
  );
}

function CodeEntry({ channel, onDone }: { channel: "sms" | "email"; onDone: () => void }) {
  const confirm = useServerFn(confirmCoworkGatewayCode);
  const [code, setCode] = useState("");
  const m = useMutation({ mutationFn: () => confirm({ data: { channel, code } }), onSuccess: () => { toast.success("Connected."); onDone(); }, onError: (e) => toast.error(errorText(e)) });
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code)) m.mutate(); }}>
      <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" className="h-9 w-36" />
      <Button type="submit" size="sm" className="btn-glow" disabled={code.length !== 6 || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Confirm</Button>
    </form>
  );
}

function SmsCard({ gateway, businessNumber, suggested }: { gateway: View | null; businessNumber: string | null; suggested: string | null }) {
  const qc = useQueryClient();
  const link = useServerFn(linkCoworkGateway);
  const [mobile, setMobile] = useState(gateway?.address ?? suggested ?? "");
  const m = useMutation({ mutationFn: () => link({ data: { channel: "sms", mobile } }), onSuccess: () => { toast.success("Code sent."); void qc.invalidateQueries({ queryKey: KEY }); }, onError: (e) => toast.error(errorText(e)) });
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  return (
    <Card icon={<MessageSquareText className="size-4" />} title="Text message" status={<Status gateway={gateway} />}>
      {!businessNumber ? (
        <p className="text-xs text-muted-foreground">Your business needs its own texting number first.</p>
      ) : gateway?.verified ? (
        <>
          <p className="text-xs text-muted-foreground">Text <span className="font-medium text-foreground">{businessNumber}</span> from {gateway.address}. Text PAUSE to stop. Each answer uses up to 3 texts.</p>
          <Manage gateway={gateway} channel="sms" />
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Text your business number ({businessNumber}) from your own mobile and Co-Work texts back. We'll send a code to check it's yours.</p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Your mobile, e.g. 0412 345 678" className="h-9 min-w-0 flex-1" />
            <Button type="submit" size="sm" variant="outline" disabled={mobile.trim().length < 8 || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Send code</Button>
          </form>
          {gateway?.awaitingCode && <CodeEntry channel="sms" onDone={refresh} />}
        </>
      )}
    </Card>
  );
}

function EmailCard({ gateway, loginEmail }: { gateway: View | null; loginEmail: string | null }) {
  const qc = useQueryClient();
  const link = useServerFn(linkCoworkGateway);
  const [address, setAddress] = useState(gateway?.address ?? loginEmail ?? "");
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const m = useMutation({
    mutationFn: () => link({ data: { channel: "email", address } }),
    onSuccess: (r) => { toast.success("verified" in r && r.verified ? "Connected." : "Code sent to that address."); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Card icon={<Mail className="size-4" />} title="Email" status={<Status gateway={gateway} />}>
      {gateway?.verified && gateway.writeTo ? (
        <>
          <p className="text-xs text-muted-foreground">Write from {gateway.address} to your private Co-Work address. Keep it to yourself: only mail from your address is answered.</p>
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/70 bg-white/60 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs">{gateway.writeTo}</code>
            <button type="button" aria-label="Copy address" onClick={() => { void navigator.clipboard?.writeText(gateway.writeTo!).then(() => toast.success("Copied.")); }} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground"><Copy className="size-3.5" /></button>
          </div>
          <Manage gateway={gateway} channel="email" />
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Email Co-Work from your own address and get the answer by email. Your login email connects at once; another address gets a code.</p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Input type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@example.com" className="h-9 min-w-0 flex-1" />
            <Button type="submit" size="sm" variant="outline" disabled={address.trim().length < 5 || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Connect</Button>
          </form>
          {gateway?.awaitingCode && <CodeEntry channel="email" onDone={refresh} />}
        </>
      )}
    </Card>
  );
}

function TelegramCard({ gateway, ready }: { gateway: View | null; ready: boolean }) {
  const qc = useQueryClient();
  const link = useServerFn(linkCoworkGateway);
  const m = useMutation({
    mutationFn: () => link({ data: { channel: "telegram" } }),
    onSuccess: (r) => { if (r.url) window.open(r.url, "_blank", "noopener"); toast.success("Press Start in Telegram to finish."); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Card icon={<Send className="size-4" />} title="Telegram" status={<Status gateway={gateway} />}>
      {!ready ? (
        <p className="text-xs text-muted-foreground">Coming soon.</p>
      ) : gateway?.verified ? (
        <>
          <p className="text-xs text-muted-foreground">Chat with the BookedSecure bot. /new starts a fresh conversation, /stop disconnects.</p>
          <Manage gateway={gateway} channel="telegram" />
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Opens Telegram with a one-time link; press Start there and you're connected.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Connect Telegram</Button>
            {gateway && !gateway.verified && <Button type="button" size="sm" variant="ghost" onClick={() => void qc.invalidateQueries({ queryKey: KEY })}>I pressed Start</Button>}
          </div>
        </>
      )}
    </Card>
  );
}
