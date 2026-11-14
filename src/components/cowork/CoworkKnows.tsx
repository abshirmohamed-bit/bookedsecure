import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MEMORY_MAX, SKILL_NAME_MAX, SKILL_STEPS_MAX, SKILL_WHEN_MAX, type Memory, type MemoryKind, type Skill } from "@/lib/cowork-memory";
import { deleteCoworkMemory, deleteCoworkSkill, getCoworkKnowledge, saveCoworkMemory, saveCoworkSkill } from "@/lib/cowork-memory.functions";

const KEY = ["cowork-knowledge"] as const;
/** Something the review learned in the last few days shows as New. */
const NEW_MS = 3 * 86_400_000;
const isNew = (item: { origin: string; createdAt: string }) => item.origin === "review" && Date.now() - Date.parse(item.createdAt) < NEW_MS;

/**
 * What Co-Work knows: the facts and preferences it remembers about this
 * business and the skills it saved, with Co-Work's own learning marked New.
 * Owners edit and remove; the team can read.
 */
export function CoworkKnows() {
  const [open, setOpen] = useState(false);
  const load = useServerFn(getCoworkKnowledge);
  const q = useQuery({ queryKey: KEY, queryFn: () => load(), staleTime: 60_000 });
  const fresh = (q.data?.memories ?? []).filter(isNew).length + (q.data?.skills ?? []).filter(isNew).length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="What Co-Work knows" title="What Co-Work knows"
        className="relative grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground">
        <Brain className="size-[18px]" aria-hidden="true" />
        {fresh > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" aria-label={`${fresh} new`} />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
          <DialogTitle>What Co-Work knows</DialogTitle>
          <DialogDescription>
            What Co-Work remembers about your business and how you like things done, and the tasks it has learned. It uses these in every conversation. Things it learned on its own are marked New.
          </DialogDescription>
          {q.isLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : q.isError || !q.data ? <p className="text-sm text-destructive">This couldn't be loaded.</p>
            : q.data.setupMissing ? <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">Co-Work's memory is waiting for a database update (docs/cowork-memory.sql). Until then it works as before, without remembering between conversations.</p>
            : <Knowledge memories={q.data.memories} skills={q.data.skills} canEdit={q.data.canEdit} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Knowledge({ memories, skills, canEdit }: { memories: Memory[]; skills: Skill[]; canEdit: boolean }) {
  const [tab, setTab] = useState<"memories" | "skills">("memories");
  const tabClass = (on: boolean) => cn("flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none", on ? "bg-white/90 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <div className="min-w-0 space-y-3">
      <div role="tablist" className="flex w-full rounded-full border border-white/70 bg-white/40 p-1 sm:inline-flex sm:w-auto">
        <button type="button" role="tab" aria-selected={tab === "memories"} className={tabClass(tab === "memories")} onClick={() => setTab("memories")}>Remembers ({memories.length})</button>
        <button type="button" role="tab" aria-selected={tab === "skills"} className={tabClass(tab === "skills")} onClick={() => setTab("skills")}>Skills ({skills.length})</button>
      </div>
      {tab === "memories" ? <Memories memories={memories} canEdit={canEdit} /> : <Skills skills={skills} canEdit={canEdit} />}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: KEY });
}

function Memories({ memories, canEdit }: { memories: Memory[]; canEdit: boolean }) {
  const refresh = useRefresh();
  const save = useServerFn(saveCoworkMemory);
  const remove = useServerFn(deleteCoworkMemory);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<MemoryKind>("fact");
  const add = useMutation({
    mutationFn: () => save({ data: { kind, content: draft } }),
    onSuccess: () => { setDraft(""); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That couldn't be saved."),
  });
  const drop = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "That couldn't be removed."),
  });
  const groups: [string, Memory[]][] = [["Facts about the business", memories.filter((m) => m.kind === "fact")], ["How you like things done", memories.filter((m) => m.kind === "preference")]];
  return (
    <div className="space-y-4">
      {canEdit && (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 2) add.mutate(); }}>
          <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
            <option value="fact">A fact</option>
            <option value="preference">A preference</option>
          </select>
          <Input value={draft} maxLength={MEMORY_MAX} onChange={(e) => setDraft(e.target.value)} placeholder={kind === "fact" ? "e.g. We don't detail boats or caravans" : "e.g. Sign texts as Usama"} className="h-10 flex-1" />
          <Button type="submit" className="btn-glow h-10" disabled={add.isPending || draft.trim().length < 2}>{add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add</Button>
        </form>
      )}
      {!memories.length && <p className="text-sm text-muted-foreground">Nothing yet. Tell Co-Work "remember…" or just mention how you like things done, and it keeps it.</p>}
      {groups.map(([label, list]) => list.length ? (
        <section key={label} className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
          <ul className="divide-y divide-white/60 rounded-2xl border border-white/70 bg-white/45">
            {list.map((m) => <MemoryRow key={m.id} memory={m} canEdit={canEdit} onDelete={() => drop.mutate(m.id)} onSaved={refresh} />)}
          </ul>
        </section>
      ) : null)}
    </div>
  );
}

function MemoryRow({ memory, canEdit, onDelete, onSaved }: { memory: Memory; canEdit: boolean; onDelete: () => void; onSaved: () => void }) {
  const save = useServerFn(saveCoworkMemory);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content);
  const update = useMutation({
    mutationFn: () => save({ data: { id: memory.id, kind: memory.kind, content: text } }),
    onSuccess: () => { setEditing(false); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That couldn't be saved."),
  });
  return (
    <li className="flex items-start gap-2 px-3 py-2 text-sm">
      {editing ? (
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
          <Input value={text} maxLength={MEMORY_MAX} onChange={(e) => setText(e.target.value)} className="h-9 flex-1" autoFocus />
          <Button type="submit" size="sm" disabled={update.isPending || text.trim().length < 2}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setText(memory.content); }}>Cancel</Button>
        </form>
      ) : (
        <>
          <p className="min-w-0 flex-1">{memory.content}{isNew(memory) && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">New</span>}</p>
          {canEdit && (
            <span className="flex shrink-0 gap-1">
              <button type="button" aria-label="Edit" onClick={() => setEditing(true)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground"><Pencil className="size-3.5" /></button>
              <button type="button" aria-label="Remove" onClick={onDelete} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </span>
          )}
        </>
      )}
    </li>
  );
}

function Skills({ skills, canEdit }: { skills: Skill[]; canEdit: boolean }) {
  const refresh = useRefresh();
  const remove = useServerFn(deleteCoworkSkill);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const drop = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "That couldn't be removed."),
  });
  if (editing) return <SkillForm skill={editing === "new" ? null : editing} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Skills are how Co-Work did a task before, so it can do it the same way again. Texts, campaigns, posts and bookings still wait for your yes.</p>
      {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> Write a skill</Button>}
      {!skills.length && <p className="text-sm text-muted-foreground">No skills yet. After Co-Work does a task with several steps for you, it can offer to save it, or you can ask it to "do it this way every time".</p>}
      <ul className="space-y-2">
        {skills.map((s) => (
          <li key={s.id} className="rounded-2xl border border-white/70 bg-white/45 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{s.name}{isNew(s) && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">New</span>}</p>
                <p className="text-xs text-muted-foreground">{s.whenToUse}{s.uses ? ` · used ${s.uses} time${s.uses === 1 ? "" : "s"}` : ""}</p>
              </div>
              {canEdit && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label="Edit" onClick={() => setEditing(s)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground"><Pencil className="size-3.5" /></button>
                  <button type="button" aria-label="Remove" onClick={() => drop.mutate(s.id)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </span>
              )}
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-foreground/80">{s.steps}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillForm({ skill, onDone, onCancel }: { skill: Skill | null; onDone: () => void; onCancel: () => void }) {
  const save = useServerFn(saveCoworkSkill);
  const [name, setName] = useState(skill?.name ?? "");
  const [when, setWhen] = useState(skill?.whenToUse ?? "");
  const [steps, setSteps] = useState(skill?.steps ?? "");
  const m = useMutation({
    mutationFn: () => save({ data: { id: skill?.id ?? null, name, whenToUse: when, steps } }),
    onSuccess: onDone,
    onError: (e) => toast.error(e instanceof Error ? e.message : "That skill couldn't be saved."),
  });
  const ok = name.trim().length >= 2 && when.trim().length >= 2 && steps.trim().length >= 2;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ok) m.mutate(); }}>
      <label className="block text-xs font-medium">Name<Input value={name} maxLength={SKILL_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Weekly recap" className="mt-1 h-10" /></label>
      <label className="block text-xs font-medium">When to use it<Input value={when} maxLength={SKILL_WHEN_MAX} onChange={(e) => setWhen(e.target.value)} placeholder="When I ask how last week went" className="mt-1 h-10" /></label>
      <label className="block text-xs font-medium">Steps<Textarea value={steps} maxLength={SKILL_STEPS_MAX} onChange={(e) => setSteps(e.target.value)} placeholder={"1. Read last week's numbers\n2. Compare with the week before\n3. Draft a short LinkedIn post about the best result"} className="mt-1 min-h-40 text-sm" /></label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="btn-glow" disabled={!ok || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save skill</Button>
      </div>
    </form>
  );
}
