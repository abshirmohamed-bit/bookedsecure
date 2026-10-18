import { useState } from 'react';
import { CheckCircle2, Circle, Copy, Loader2, Play, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { checkChatGptConnection, type ConnectionCheck } from '@/lib/connection-test';

const prompt = 'Use the BookedSecure list_leads tool with limit 5 and offset 0. Show the returned customer names and total count. Do not change any records. If the tool is unavailable or fails, report the exact tool or authorization failure; do not invent customers.';

export function McpConnectionTest({ signedIn, accountId }: { signedIn: boolean; accountId?: string }) {
  const [result, setResult] = useState<{ accountId?: string; check: ConnectionCheck }>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const check = result?.accountId === accountId ? result?.check : undefined;
  const approved = check?.stage === 'customers' || check?.stage === 'ready';
  const ready = check?.stage === 'ready';
  async function run() {
    if (!signedIn || busy) return;
    setBusy(true);
    setResult(undefined);
    setCopied(false);
    try { setResult({ accountId, check: await checkChatGptConnection(supabase) }); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 border-b border-border pb-8" aria-labelledby="connection-test-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="connection-test-title" className="font-semibold">ChatGPT connection test</h2>
      <Button onClick={run} disabled={!signedIn || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Play className="h-4 w-4" />}
        {busy ? 'Checking…' : check ? 'Run again' : 'Run connection test'}
      </Button>
    </div>
    {!signedIn && <p className="text-sm text-muted-foreground">Sign in to test your connection.</p>}
    <ol className="space-y-4 text-sm">
      <li className="flex gap-3">{approved ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}<div><h3 className="font-medium">1. ChatGPT authorization</h3><p className="mt-1 text-muted-foreground">{approved ? 'Approval found for this BookedSecure account.' : 'Awaiting approval check.'}</p></div></li>
      <li className="flex gap-3">{ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}<div className="min-w-0"><h3 className="font-medium">2. Read-only customer lookup</h3><p className="mt-1 text-muted-foreground">{ready ? `${check.total} customers and leads accessible; showing up to five recent names.` : 'Awaiting customer-access check.'}</p>
        {ready && <ul className="mt-2 space-y-1">{check.customers?.length ? check.customers.map(customer => <li key={customer.id} className="break-words">{customer.name || 'Unnamed customer'}</li>) : <li>No customers yet. The lookup succeeded.</li>}</ul>}
      </div></li>
      <li className="flex gap-3"><Circle className="h-5 w-5 shrink-0 text-muted-foreground" /><div className="min-w-0 space-y-2"><h3 className="font-medium">3. Confirm the read in ChatGPT</h3><p className="text-muted-foreground">Not yet verified. These checks do not prove ChatGPT has called BookedSecure. Compare its answer with the names and count above.</p>
        {ready && <><p className="break-words rounded-md bg-muted p-3">{prompt}</p><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { setCopied(false); } }}><Copy className="h-4 w-4" />{copied ? 'Prompt copied' : 'Copy test prompt'}</Button><p className="text-xs text-muted-foreground">If copying fails, select the prompt above.</p></>}
      </div></li>
    </ol>
    <div role="status" aria-live="polite" className="text-sm">{busy ? 'Checking approval and customer access…' : check && <p className="flex items-start gap-2">{ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />}{check.message}</p>}</div>
    <details className="text-sm"><summary className="cursor-pointer font-medium">ChatGPT still cannot read customers?</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground"><li>Login or request expired: start a new connection in ChatGPT and approve it using this same account.</li><li>No BookedSecure tools available: confirm the app is enabled in the chat. Reconnect to refresh its tools after a BookedSecure update.</li><li>Authorization denied: reconnect and approve access. Do not paste login tokens into ChatGPT.</li><li>Different customers: check that ChatGPT was connected to the same business account.</li><li>A failed tool call: share its error with BookedSecure, without passwords or tokens. A successful check here does not replace the ChatGPT test.</li></ul></details>
  </section>;
}