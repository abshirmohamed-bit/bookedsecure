import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { youtubeVideoUrl } from "@/lib/youtube";
import { getYouTubeComments, postYouTubeCommentReply, startYouTubeConnect, suggestYouTubeCommentReply } from "@/lib/youtube.functions";

type Comment = Awaited<ReturnType<typeof getYouTubeComments>>["comments"][number];

export function YouTubeComments({ isOwner }: { isOwner: boolean }) {
  const load = useServerFn(getYouTubeComments);
  const q = useQuery({ queryKey: ["youtube-comments"], queryFn: () => load(), staleTime: 2 * 60_000 });
  const connect = useServerFn(startYouTubeConnect);
  const reconnect = useMutation({ mutationFn: () => connect(), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't start the Google sign-in.") });
  const [filter, setFilter] = useState<"waiting" | "all">("waiting");

  if (q.isLoading) return <div className="glass grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <div className="glass p-6 text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Couldn't load comments."}</div>;
  const list = q.data.comments.filter((c) => filter === "all" || !c.answered);

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([["waiting", "Waiting for a reply"], ["all", "All comments"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${filter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />Check now</Button>
      </div>
      {q.data.needsReconnect && isOwner && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
          <p className="text-muted-foreground">Reconnect YouTube once and allow comments so you can reply from here.</p>
          <Button size="sm" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>Reconnect YouTube</Button>
        </div>
      )}
      {list.length === 0 ? (
        <div className="glass p-8 text-center text-sm text-muted-foreground">{filter === "waiting" ? "No comments are waiting for a reply." : "No comments yet."}</div>
      ) : list.map((c) => <CommentCard key={c.threadId} comment={c} canReply={isOwner && !q.data.needsReconnect} />)}
    </div>
  );
}

function CommentCard({ comment, canReply }: { comment: Comment; canReply: boolean }) {
  const qc = useQueryClient();
  const suggest = useServerFn(suggestYouTubeCommentReply);
  const post = useServerFn(postYouTubeCommentReply);
  const [reply, setReply] = useState("");
  const suggestM = useMutation({
    mutationFn: () => suggest({ data: { text: comment.text, videoTitle: comment.videoTitle } }),
    onSuccess: (r) => { if (r.text) setReply(r.text); else toast.message("This comment doesn't seem to need a reply."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't suggest a reply."),
  });
  const postM = useMutation({
    mutationFn: () => post({ data: { parentId: comment.commentId, text: reply } }),
    onSuccess: async () => { toast.success("Reply posted on YouTube."); setReply(""); await qc.invalidateQueries({ queryKey: ["youtube-comments"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The reply wasn't posted."),
  });
  return (
    <article className="glass space-y-2 p-4">
      <div className="flex items-start gap-3">
        {comment.authorImage ? <img src={comment.authorImage} alt="" className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-muted" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm"><span className="font-semibold">{comment.author}</span> <span className="text-[11px] text-muted-foreground">{comment.publishedAt ? relativeTime(comment.publishedAt) : ""}</span></p>
          <p className="whitespace-pre-wrap text-sm">{comment.text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {comment.videoTitle && <a href={youtubeVideoUrl(comment.videoId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><ExternalLink className="h-3 w-3" />{comment.videoTitle}</a>}
            {comment.answered && <span className="inline-flex items-center gap-1 text-[#30a14e]"><CheckCircle2 className="h-3 w-3" />You replied</span>}
            {comment.replies > 0 && <span>{comment.replies} repl{comment.replies === 1 ? "y" : "ies"}</span>}
          </p>
        </div>
      </div>
      {canReply && (
        <div className="space-y-2 pl-11">
          <Textarea rows={2} value={reply} maxLength={10_000} placeholder="Write a reply" onChange={(e) => setReply(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={suggestM.isPending} onClick={() => suggestM.mutate()}>
              {suggestM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />} Suggest a reply
            </Button>
            <Button size="sm" disabled={!reply.trim() || postM.isPending} onClick={() => postM.mutate()}>
              {postM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Post reply
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
