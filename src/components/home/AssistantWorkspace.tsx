import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, History, MessageSquarePlus, PanelLeft, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OwnerAssistant, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { PerformanceIsland } from "@/components/home/PerformanceIsland";
import { createAssistantConversation, deleteAssistantConversation, getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";
import { Button } from "@/components/ui/button";
import { SiteOnboardingPanel } from "@/components/settings/SiteOnboardingPanel";
import { getSession } from "@/lib/app.functions";

export function AssistantWorkspace({ requestedThreadId }: { requestedThreadId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getHome = useServerFn(getAssistantHome);
  const getConversation = useServerFn(getAssistantConversation);
  const createConversation = useServerFn(createAssistantConversation);
  const deleteConversation = useServerFn(deleteAssistantConversation);
  const fetchSession = useServerFn(getSession);
  const [mobileHistory, setMobileHistory] = useState(false);
  const [websiteSetup, setWebsiteSetup] = useState(false);
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });
  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const activeId = requestedThreadId ?? home.data?.ongoing.id;
  const conversation = useQuery({ queryKey: ["assistant-conversation", activeId], enabled: Boolean(activeId), queryFn: () => getConversation({ data: { threadId: activeId! } }) });
  const createThread = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: async (thread) => { await queryClient.invalidateQueries({ queryKey: ["assistant-home"] }); navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } }); setMobileHistory(false); },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeThread = useMutation({
    mutationFn: (threadId: string) => deleteConversation({ data: { threadId } }),
    onSuccess: async (ongoing) => { await queryClient.invalidateQueries({ queryKey: ["assistant-home"] }); navigate({ to: "/assistant/$threadId", params: { threadId: ongoing.id } }); },
    onError: (error: Error) => toast.error(error.message),
  });
  if (home.isLoading || (activeId && conversation.isLoading)) return <div className="grid min-h-[70vh] place-items-center text-sm text-muted-foreground">Opening Assistant…</div>;
  if (home.error || conversation.error || !activeId || !conversation.data) return <div className="grid min-h-[70vh] place-items-center text-sm text-destructive">Assistant could not be opened.</div>;

  const threads = conversation.data.threads;
  const turns: OwnerAssistantTurn[] = conversation.data.messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? "you" : "assistant",
    text: message.text,
    ...(message.proposals.length ? { proposals: message.proposals as NonNullable<OwnerAssistantTurn["proposals"]> } : {}),
    ...(message.done ? { done: message.done } : {}),
  }));
  const history = <div className="flex h-full flex-col">
    <div className="flex items-center justify-between px-3 py-3"><div className="flex items-center gap-2"><History className="h-4 w-4" /><span className="text-sm font-semibold">Conversations</span></div><button className="lg:hidden" onClick={() => setMobileHistory(false)} aria-label="Close history"><X className="h-4 w-4" /></button></div>
    <Button variant="outline" className="mx-3 justify-start" onClick={() => createThread.mutate()} disabled={createThread.isPending}><MessageSquarePlus className="h-4 w-4" /> New conversation</Button>
    <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2">{threads.map((thread) => <div key={thread.id} className={`group flex items-center rounded-lg ${thread.id === activeId ? "bg-primary/10 text-primary" : "hover:bg-secondary"}`}>
      <button className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-xs font-medium" onClick={() => { navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } }); setMobileHistory(false); }}>{thread.isDefault ? "Ongoing conversation" : thread.title}</button>
      {!thread.isDefault && <button className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${thread.title}`} onClick={() => window.confirm("Delete this conversation?") && removeThread.mutate(thread.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
    </div>)}</div>
    {session.data?.role === "owner" && <button onClick={() => { setWebsiteSetup(true); setMobileHistory(false); }} className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"><Globe2 className="h-4 w-4" /> Set up from website</button>}
  </div>;

  return <div className="relative -m-3 h-[calc(100dvh-4rem)] overflow-hidden bg-background sm:-m-5 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="hidden min-h-0 border-r border-border bg-card/40 lg:block">{history}</aside>
    {mobileHistory && <><button className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileHistory(false)} aria-label="Close history overlay" /><aside className="fixed inset-y-0 left-0 z-50 w-[min(84vw,300px)] border-r border-border bg-background lg:hidden">{history}</aside></>}
    <main className="relative flex min-h-0 flex-col overflow-hidden">
      <button onClick={() => setMobileHistory(true)} className="absolute left-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-border bg-card shadow lg:hidden" aria-label="Open conversation history"><PanelLeft className="h-4 w-4" /></button>
      <div className="absolute right-3 top-3 z-20 w-[min(360px,calc(100%-4.5rem))] lg:w-44"><PerformanceIsland /></div>
      <OwnerAssistant key={activeId} threadId={activeId} initialTurns={turns} onConversationChanged={() => { queryClient.invalidateQueries({ queryKey: ["assistant-home"] }); }} />
    </main>
    {websiteSetup && <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-3 sm:p-8"><div className="mx-auto max-w-5xl rounded-2xl bg-background p-4 shadow-2xl sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-heading text-lg font-semibold">Set up from your website</h2><p className="text-xs text-muted-foreground">Review everything before it is saved.</p></div><button onClick={() => setWebsiteSetup(false)} className="rounded-full p-2 hover:bg-secondary" aria-label="Close website setup"><X className="h-4 w-4" /></button></div><SiteOnboardingPanel readOnly={false} onApplied={() => setWebsiteSetup(false)} /></div></div>}
  </div>;
}