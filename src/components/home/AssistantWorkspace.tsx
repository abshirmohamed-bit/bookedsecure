import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Eraser, Globe2, History, MessageSquarePlus, PanelLeft, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OwnerAssistant, type OwnerAssistantTurn } from "@/components/home/OwnerAssistant";
import { PerformanceIsland } from "@/components/home/PerformanceIsland";
import { clearAssistantConversation, createAssistantConversation, deleteAssistantConversation, getAssistantConversation, getAssistantHome } from "@/lib/assistant-history.functions";
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
  const clearConversation = useServerFn(clearAssistantConversation);
  const fetchSession = useServerFn(getSession);
  const [mobileHistory, setMobileHistory] = useState(false);
  const [websiteSetup, setWebsiteSetup] = useState(false);
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });
  const home = useQuery({ queryKey: ["assistant-home"], queryFn: () => getHome() });
  const activeId = requestedThreadId ?? home.data?.ongoing.id;
  const conversation = useQuery({
    queryKey: ["assistant-conversation", activeId],
    enabled: Boolean(activeId),
    queryFn: () => {
      if (!activeId) throw new Error("No conversation selected.");
      return getConversation({ data: { threadId: activeId } });
    },
  });
  const createThread = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: async (thread) => { await queryClient.invalidateQueries({ queryKey: ["assistant-home"] }); navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } }); setMobileHistory(false); },
    onError: (error: Error) => toast.error(error.message),
  });
  const clearThread = useMutation({
    mutationFn: (threadId: string) => clearConversation({ data: { threadId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assistant-conversation"] });
      await queryClient.invalidateQueries({ queryKey: ["assistant-home"] });
      setMobileHistory(false);
      toast.success("Chat cleared.");
    },
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
  const history = <div className="flex h-full min-h-0 flex-col pb-[env(safe-area-inset-bottom)]">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center px-3 py-3"><div className="flex min-w-0 items-center gap-2"><History className="h-4 w-4 shrink-0" /><span className="truncate text-sm font-semibold">Conversations</span></div><Button type="button" size="icon" variant="ghost" className="lg:hidden" onClick={() => setMobileHistory(false)} aria-label="Close history"><X className="h-4 w-4" /></Button></div>
    <Button variant="outline" className="mx-3 justify-start" onClick={() => createThread.mutate()} disabled={createThread.isPending}><MessageSquarePlus className="h-4 w-4" /> New conversation</Button>
    <Button variant="ghost" className="mx-3 mt-1 justify-start text-muted-foreground" disabled={clearThread.isPending || turns.length === 0} onClick={() => { if (activeId && window.confirm("Clear every message in this chat?")) clearThread.mutate(activeId); }}><Eraser className="h-4 w-4" /> Clear chat</Button>
    <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2">{threads.map((thread) => <div key={thread.id} className={`group flex items-center rounded-lg ${thread.id === activeId ? "bg-primary/10 text-primary" : "hover:bg-secondary"}`}>
      <button className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-xs font-medium" onClick={() => { navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } }); setMobileHistory(false); }}>{thread.isDefault ? "Ongoing conversation" : thread.title}</button>
      {!thread.isDefault && <Button type="button" size="icon" variant="ghost" className="mr-1 shrink-0 text-muted-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100" aria-label={`Delete ${thread.title}`} onClick={() => window.confirm("Delete this conversation?") && removeThread.mutate(thread.id)}><Trash2 className="h-4 w-4" /></Button>}
    </div>)}</div>
    {session.data?.role === "owner" && <button onClick={() => { setWebsiteSetup(true); setMobileHistory(false); }} className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"><Globe2 className="h-4 w-4" /> Set up from website</button>}
  </div>;

  return <div className="relative -mx-4 -my-5 h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-background sm:-mx-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="hidden min-h-0 border-r border-border bg-card/40 lg:block">{history}</aside>
    {mobileHistory && <><button className="fixed inset-0 z-40 bg-foreground/25 lg:hidden" onClick={() => setMobileHistory(false)} aria-label="Close history overlay" /><aside className="fixed inset-y-0 left-0 z-50 w-[min(86vw,320px)] border-r border-border bg-background lg:hidden">{history}</aside></>}
    <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-3 pt-3 lg:pointer-events-none lg:absolute lg:inset-x-3 lg:top-3 lg:z-20 lg:flex lg:px-0 lg:pt-0">
        <Button type="button" size="icon" variant="outline" onClick={() => setMobileHistory(true)} className="size-11 shrink-0 rounded-full bg-card shadow lg:pointer-events-auto lg:hidden" aria-label="Open conversation history"><PanelLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1 lg:pointer-events-auto lg:ml-auto lg:w-44 lg:flex-none"><PerformanceIsland /></div>
      </div>
      <OwnerAssistant key={activeId} threadId={activeId} initialTurns={turns} onConversationChanged={() => { queryClient.invalidateQueries({ queryKey: ["assistant-home"] }); }} />
    </main>
    {websiteSetup && <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-3 sm:p-8"><div className="mx-auto max-w-5xl rounded-2xl bg-background p-4 shadow-2xl sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-heading text-lg font-semibold">Set up from your website</h2><p className="text-xs text-muted-foreground">Review everything before it is saved.</p></div><button onClick={() => setWebsiteSetup(false)} className="rounded-full p-2 hover:bg-secondary" aria-label="Close website setup"><X className="h-4 w-4" /></button></div><SiteOnboardingPanel readOnly={false} onApplied={() => setWebsiteSetup(false)} /></div></div>}
  </div>;
}