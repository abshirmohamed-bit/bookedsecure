import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getReviewRequest, saveReviewRequest } from "@/lib/review-requests.functions";

const DELAYS: { value: number; label: string }[] = [
  { value: 60, label: "1 hour after" },
  { value: 180, label: "3 hours after" },
  { value: 1440, label: "Next day" },
  { value: 2880, label: "2 days after" },
];

/** "Ask for a review": one text after each job is marked done, with the owner's review link. */
export function ReviewRequestCard() {
  const qc = useQueryClient();
  const load = useServerFn(getReviewRequest);
  const save = useServerFn(saveReviewRequest);
  const q = useQuery({ queryKey: ["review-request"], queryFn: () => load() });
  const [active, setActive] = useState(false);
  const [delay, setDelay] = useState(180);
  const [link, setLink] = useState("");
  const [template, setTemplate] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setActive(q.data.active);
    setDelay(q.data.delayMinutes);
    setLink(q.data.reviewLink ?? "");
    // Show the link as a placeholder so changing it in the box updates the message.
    setTemplate(q.data.reviewLink ? q.data.template.replace(q.data.reviewLink, "{{review_link}}") : q.data.template);
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: (next: { active: boolean }) =>
      save({ data: { active: next.active, delayMinutes: delay, template, reviewLink: link.trim() || null } }),
    onSuccess: async (_r, next) => {
      toast.success(next.active ? "Review requests are on." : "Review request saved.");
      await qc.invalidateQueries({ queryKey: ["review-request"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });

  const d = q.data;
  const readOnly = !d?.isOwner;
  const preview = template
    .replace(/\{\{\s*first_name\s*\}\}/g, "Sam")
    .replace(/\{\{\s*business_name\s*\}\}/g, "your business")
    .replace(/\{\{\s*review_link\s*\}\}/g, link.trim() || "(your review link)");

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Star className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Ask for a review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            After a job is marked done, text the customer once asking for a review. Only customers who agreed to texts get it, never twice for the same job, and never during quiet hours.
          </p>
        </div>
        <Switch
          checked={active}
          disabled={!d || readOnly || mutation.isPending}
          onCheckedChange={(value) => { setActive(value); mutation.mutate({ active: value }); }}
          aria-label="Ask for a review"
        />
      </div>
      {d && (
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Review link</span>
              <Input value={link} disabled={readOnly} placeholder="https://g.page/r/... (your Google review link)" onChange={(e) => setLink(e.target.value)} />
              <span className="block text-xs text-muted-foreground">In Google Business Profile, choose "Ask for reviews" and copy the link.</span>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">When</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={delay} disabled={readOnly} onChange={(e) => setDelay(Number(e.target.value))}>
                {(DELAYS.some((x) => x.value === delay) ? DELAYS : [...DELAYS, { value: delay, label: `${delay} minutes after` }]).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
          </div>
          <div className="space-y-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Message</span>
              <Textarea rows={4} value={template} disabled={readOnly} maxLength={480} onChange={(e) => setTemplate(e.target.value)} />
              <span className="block text-xs text-muted-foreground">{"{{first_name}}, {{business_name}} and {{review_link}} are filled in for each customer."}</span>
            </label>
            <p className="rounded-lg bg-secondary/60 p-2 text-xs"><span className="font-medium">Preview: </span>{preview}</p>
            {!readOnly && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ active })}>Save</Button>}
          </div>
        </div>
      )}
    </section>
  );
}
