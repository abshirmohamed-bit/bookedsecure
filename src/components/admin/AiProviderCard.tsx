import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkExternalAi, getAiRouting, setAiRouting } from "@/lib/ai-routing.functions";

type Choice = "external" | "lovable" | "external-only";

export function AiProviderCard() {
  const qc = useQueryClient();
  const fetchRouting = useServerFn(getAiRouting);
  const save = useServerFn(setAiRouting);
  const check = useServerFn(checkExternalAi);
  const { data, error } = useQuery({ queryKey: ["ai-routing"], queryFn: () => fetchRouting(), retry: false });
  const [choice, setChoice] = useState<Choice>("lovable");
  const [fast, setFast] = useState("");
  const [agent, setAgent] = useState("");
  useEffect(() => {
    if (!data) return;
    setChoice(data.primary === "lovable" ? "lovable" : data.lovableStandby ? "external" : "external-only");
    setFast(data.fastModel); setAgent(data.agentModel);
  }, [data]);
  const saveMut = useMutation({
    mutationFn: () => save({ data: { primary: choice === "lovable" ? "lovable" : "external", lovableStandby: choice !== "external-only", fastModel: fast, agentModel: agent } }),
    onSuccess: () => { toast.success("AI provider saved"); qc.invalidateQueries({ queryKey: ["ai-routing"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const checkMut = useMutation({
    mutationFn: () => check(),
    onSuccess: (r) => { (r.ok ? toast.success : toast.error)(r.message); qc.invalidateQueries({ queryKey: ["ai-routing"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (error) return null;
  const options: Array<[Choice, string, string]> = [
    ["external", "Cheaper Inference, Lovable on standby", "Recommended while testing"],
    ["external-only", "Cheaper Inference only", "Lovable AI turned off"],
    ["lovable", "Lovable AI", "Current default"],
  ];
  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">AI provider</h2>
        <p className="text-sm text-muted-foreground">Powers owner chat and every quote page. Business backup keys still apply.</p>
      </div>
      {!data?.keyConfigured && <p className="text-sm text-destructive">Cheaper Inference key not saved yet.</p>}
      <div className="grid gap-2">
        {options.map(([value, label, hint]) => (
          <label key={value} className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
            <input type="radio" name="ai-primary" checked={choice === value} onChange={() => setChoice(value)} className="mt-1" />
            <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Quote chat model<Input value={fast} onChange={(e) => setFast(e.target.value)} /></label>
        <label className="text-sm">Owner chat model<Input value={agent} onChange={(e) => setAgent(e.target.value)} /></label>
      </div>
      {data?.lastCheck && (
        <p className={`text-sm ${data.lastCheck.ok ? "text-muted-foreground" : "text-destructive"}`}>
          Last check {new Date(data.lastCheck.at).toLocaleString("en-AU")}: {data.lastCheck.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save</Button>
        <Button variant="outline" onClick={() => checkMut.mutate()} disabled={checkMut.isPending || !data?.keyConfigured}>
          {checkMut.isPending ? "Checking…" : "Run health check"}
        </Button>
      </div>
    </section>
  );
}
