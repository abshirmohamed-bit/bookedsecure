import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { convertSocialComment, listSocialComments, reviewSocialComment } from "@/lib/social-comments.functions";

export const Route = createFileRoute("/social")({
  head: () => ({
    meta: [
      { title: "Facebook comments | BookedSecure" },
      { name: "description", content: "Review AI-drafted replies to Facebook comments, approve them for posting, or turn commenters into customers." },
      { property: "og:title", content: "Facebook comments | BookedSecure" },
      { property: "og:description", content: "Review and approve replies to your Facebook comments in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SocialPage,
});

type Status = "pending_review" | "approved" | "posted" | "failed" | "dismissed";
const TABS: { status: Status; label: string }[] = [
  { status: "pending_review", label: "To review" },
  { status: "approved", label: "Waiting to post" },
  { status: "posted", label: "Posted" },
  { status: "failed", label: "Couldn't post" },
  { status: "dismissed", label: "Dismissed" },
];
type Row = Awaited<ReturnType<typeof listSocialComments>>[number];

function SocialPage() {
  const [status, setStatus] = useState<Status>("pending_review");
  const list = useServerFn(listSocialComments);
  const q = useQuery({ queryKey: ["social-comments", status], queryFn: () => list({ data: { status } }) });
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Facebook comments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Comments sent in by Make land here with a suggested reply. Approve to have Make post it, or dismiss. Nothing is posted until you approve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Button key={t.status} size="sm" variant={t.status === status ? "default" : "outline"} onClick={() => setStatus(t.status)}>
              {t.label}
            </Button>
          ))}
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : q.isError ? <p className="text-sm text-destructive">Could not load comments.</p>
          : (q.data ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Nothing here yet. Connect Make with an API key that has comment inbox access in{" "}
              <Link to="/settings/integrations" className="text-primary underline">AI connections</Link>.
            </div>
          ) : (q.data ?? []).map((r) => <CommentCard key={r.id} row={r} />)}
      </div>
    </AppShell>
  );
}

function CommentCard({ row }: { row: Row }) {
  const qc = useQueryClient();
  const review = useServerFn(reviewSocialComment);
  const convert = useServerFn(convertSocialComment);
  const [reply, setReply] = useState(row.approved_response ?? row.draft_response ?? "");
  const [converting, setConverting] = useState(false);
  const [name, setName] = useState(row.author_name ?? "");
  const [mobile, setMobile] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["social-comments"] });
  const act = useMutation({
    mutationFn: (action: "approve" | "dismiss" | "reopen") => review({ data: { id: row.id, action, reply } }),
    onSuccess: (_r, a) => { toast.success(a === "approve" ? "Approved — Make will post it on its next run." : a === "dismiss" ? "Dismissed." : "Moved back to review."); void done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update."),
  });
  const conv = useMutation({
    mutationFn: () => convert({ data: { id: row.id, name, mobile } }),
    onSuccess: () => { toast.success("Added as a customer. No text was sent."); setConverting(false); void done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add customer."),
  });
  const editable = row.status === "pending_review" || row.status === "failed";
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{row.author_name ?? "Someone"}</span>
          <span className="text-muted-foreground"> · {row.platform} · {new Date(row.commented_at ?? row.created_at).toLocaleString("en-AU")}</span>
          {row.sentiment ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{row.sentiment}</span> : null}
        </div>
        {row.comment_url ? <a href={row.comment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" />Open</a> : null}
      </div>
      <p className="whitespace-pre-wrap text-sm">{row.comment_text}</p>
      {row.post_text ? <p className="line-clamp-2 text-xs text-muted-foreground">On post: {row.post_text}</p> : null}
      {row.response_reason ? <p className="text-xs text-muted-foreground">Why reply: {row.response_reason}</p> : null}
      {row.post_error ? <p className="text-xs text-destructive">Posting failed: {row.post_error}</p> : null}
      {editable ? (
        <Textarea aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write your reply" />
      ) : row.approved_response ? (
        <p className="rounded-md bg-secondary p-2 text-sm">Reply: {row.approved_response}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable && <Button size="sm" disabled={act.isPending || !reply.trim()} onClick={() => act.mutate("approve")}>Approve reply</Button>}
        {row.status !== "posted" && row.status !== "dismissed" && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("dismiss")}>Dismiss</Button>}
        {(row.status === "approved" || row.status === "dismissed") && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("reopen")}>Back to review</Button>}
        {row.lead_id ? (
          <Link to="/leads/$leadId" params={{ leadId: row.lead_id }} className="inline-flex items-center text-sm text-primary underline">Open customer</Link>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConverting((v) => !v)}>Convert to lead</Button>
        )}
      </div>
      {converting && !row.lead_id && (
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="max-w-44" />
          <Input aria-label="Mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile (they gave you)" className="max-w-52" />
          <Button size="sm" disabled={conv.isPending || !name.trim() || mobile.trim().length < 8} onClick={() => conv.mutate()}>Add customer</Button>
        </div>
      )}
    </div>
  );
}
