import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getEmailTheme, saveEmailThemeFn } from "@/lib/email-inbox.functions";
import { EMAIL_THEME_PRESETS, EXAMPLE_EMAIL_THEME, parseEmailTheme, resolveEmailLook } from "@/lib/email-theme";
import { renderEmailHtml } from "@/lib/email-template";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Email template: upload or paste a JSON file of design choices, see a sample
 * email drawn with it, then apply it to every business email. Shown inside the
 * "Your email address" dialog (onBack returns to the address form).
 */
export function EmailTemplatePanel({ signature, onBack }: { signature: string | null; onBack: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getEmailTheme);
  const save = useServerFn(saveEmailThemeFn);
  const state = useQuery({ queryKey: ["email-theme"], queryFn: () => load(), staleTime: 60_000 });
  const [text, setText] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const value = text ?? (state.data ? pretty(state.data.theme ?? EXAMPLE_EMAIL_THEME) : "");
  const parsed = useMemo(() => (value.trim() ? parseEmailTheme(value) : null), [value]);

  const preview = useMemo(() => {
    if (!state.data) return "";
    const brand = { ...state.data.preview, theme: parsed?.theme ?? state.data.theme };
    const sign = signature?.trim() ? `\n\n${signature.trim()}` : "";
    return renderEmailHtml(brand, {
      bodyText: `Hi there,\n\nThanks for getting in touch. This is how your emails look to the people you write to: inbox emails, replies and campaigns all use this template.${sign}`,
      unsubscribeUrl: "https://bookedsecure.com",
    });
  }, [state.data, parsed, signature]);

  const apply = useMutation({
    mutationFn: (theme: Record<string, unknown> | null) => save({ data: { theme } }),
    onSuccess: (_r, theme) => {
      toast.success(theme ? "Template applied to all your business emails." : "Back to the BookedSecure look.");
      setText(null);
      void qc.invalidateQueries({ queryKey: ["email-theme"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The template could not be saved."),
  });

  function download() {
    const blob = new Blob([`${pretty(parsed?.theme ?? state.data?.theme ?? EXAMPLE_EMAIL_THEME)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email-template.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    if (f.size > 20_000) return void toast.error("That file is too big for an email template (20 KB at most).");
    setText(await f.text());
  }

  if (state.isLoading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (state.isError || !state.data) return <p className="text-sm text-destructive">The email template couldn't be loaded.</p>;
  const d = state.data;
  const unchanged = text === null;
  const canApply = d.canEdit && !d.setupMissing && Boolean(parsed?.theme) && !unchanged && !apply.isPending;

  return (
    <div className="min-w-0 space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <ArrowLeft className="size-3.5" /> Your email address
      </button>
      {d.setupMissing && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-xs">Email templates are waiting for a database update (docs/email-theme.sql). You can try one in the preview now; applying it works once that's done.</p>
      )}
      <div role="radiogroup" aria-label="Ready-made templates" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {EMAIL_THEME_PRESETS.map((p) => {
          const look = resolveEmailLook(p.theme);
          const selected = value.trim() === pretty(p.theme);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={p.forWho}
              onClick={() => setText(pretty(p.theme))}
              className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border bg-white/60 p-2 text-left transition-colors hover:bg-white/90", selected ? "border-primary ring-2 ring-primary/30" : "border-white/70")}
            >
              <span className="flex h-9 items-end gap-1 rounded-lg p-1.5" style={{ background: look.page }}>
                <span className="h-full flex-1" style={{ background: look.card, borderRadius: look.cardRadius === "0" ? 2 : 6 }} />
                <span className="h-3 w-6" style={{ background: look.brand, borderRadius: look.buttonRadius === "0" ? 1 : 999 }} />
              </span>
              <span className="text-xs font-medium leading-tight">{p.label}</span>
              <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{p.forWho}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => file.current?.click()}><Upload className="size-4" /> Upload .json</Button>
            <Button type="button" size="sm" variant="ghost" onClick={download}><Download className="size-4" /> {d.theme ? "Download yours" : "Download example"}</Button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <Textarea
            aria-label="Email template JSON"
            spellCheck={false}
            value={value}
            onChange={(e) => setText(e.target.value)}
            className="min-h-64 font-mono text-xs md:min-h-80"
          />
          {parsed && parsed.errors.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-destructive">{parsed.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Colours are hex like #1e5fc2. Fonts: system, arial, helvetica, verdana, trebuchet, georgia, times. Buttons: rounded, square or pill. Layout: plain (a clean letter, the default) or card. Design only: emails keep your text, footer and unsubscribe line.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
          <iframe title="Email preview" sandbox="" srcDoc={preview} className="h-80 w-full rounded-xl border border-white/70 bg-white md:h-[26rem]" />
        </div>
      </div>
      {d.canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {d.theme && (
            <Button type="button" variant="ghost" size="sm" className="mr-auto" disabled={apply.isPending || d.setupMissing} onClick={() => { if (window.confirm("Go back to the BookedSecure look for all your emails?")) apply.mutate(null); }}>
              <RotateCcw className="size-4" /> Reset to BookedSecure look
            </Button>
          )}
          <Button type="button" className="btn-glow" disabled={!canApply} onClick={() => parsed?.theme && apply.mutate(parsed.theme as Record<string, unknown>)}>
            {apply.isPending && <Loader2 className="size-4 animate-spin" />} Apply to all emails
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the business owner can change the template.</p>
      )}
    </div>
  );
}
