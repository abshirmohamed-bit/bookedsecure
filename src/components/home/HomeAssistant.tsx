import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Maximize2, Sparkles } from "lucide-react";
import { OwnerAssistant, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";

/**
 * The Assistant inside Home (tablet and wider): the owner's ongoing
 * conversation, the same one as the Assistant page, so a chat started here
 * carries on there and back. Confirmations work exactly as on the full page.
 */
export function HomeAssistant() {
  const queryClient = useQueryClient();
  const getHome = useServerFn(getAssistantHome);
  const getConversation = useServerFn(getAssistantConversation);
  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const threadId = home.data?.ongoing.id;
  const conversation = useQuery({
    queryKey: ["assistant-conversation", threadId],
    enabled: Boolean(threadId),
    queryFn: () => getConversation({ data: { threadId: threadId! } }),
  });

  const turns: OwnerAssistantTurn[] = (conversation.data?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "you" : "assistant",
    text: message.text,
    ...(message.proposals.length ? { proposals: message.proposals as NonNullable<OwnerAssistantTurn["proposals"]> } : {}),
    ...(message.done ? { done: message.done } : {}),
  }));

  return (
    <section aria-label="Co-work" className="flex h-[34rem] min-h-0 xl:h-[max(30rem,calc(100dvh-20rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm 2xl:h-[38rem]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> Co-work</h2>
        <Link to="/assistant" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Maximize2 className="size-3.5" /> Full page and history
        </Link>
      </div>
      {home.isLoading || (threadId && conversation.isLoading) ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : !threadId || conversation.isError ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
          Co-work couldn't be opened here. <Link to="/assistant" className="font-medium text-primary hover:underline">Open the full page</Link>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <OwnerAssistant
            key={threadId}
            threadId={threadId}
            initialTurns={turns}
            compact
            label="Co-work"
            onConversationChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["assistant-home"] });
            }}
          />
        </div>
      )}
    </section>
  );
}
