import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Copy-paste code that puts the business's own quote page on its website:
 * a button that opens it, or the quote chat built into a page. Enquiries land
 * in Leads exactly as they do from the quote link.
 */
export function WebsiteEmbed({ slug }: { slug: string | null }) {
  const [kind, setKind] = useState<"button" | "inline">("inline");
  if (!slug) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://bookedsecure.com";
  const url = `${origin}/quote/${slug}`;
  const code = kind === "inline"
    ? `<iframe src="${url}" title="Get a quote" style="width:100%;max-width:480px;height:720px;border:0;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12)" loading="lazy" allow="clipboard-write"></iframe>`
    : `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#1d4ed8;color:#fff;font:600 16px/1 system-ui,sans-serif;text-decoration:none">Get a quote</a>`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast.success("Copied. Paste it into your website's HTML or embed block."); }
    catch { toast.error("Couldn't copy. Select the code and copy it."); }
  };
  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Add it to your website</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Paste this into your website (in GoDaddy, Wix, Squarespace or WordPress use an "HTML" or "Embed code" block). Enquiries arrive in Leads, the same as from your quote link.
      </p>
      <div className="mt-2 inline-flex rounded-lg border border-border p-0.5 text-xs">
        <button type="button" onClick={() => setKind("inline")} className={`rounded-md px-2.5 py-1 ${kind === "inline" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>Quote chat on the page</button>
        <button type="button" onClick={() => setKind("button")} className={`rounded-md px-2.5 py-1 ${kind === "button" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>"Get a quote" button</button>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-[11px] leading-4">{code}</code>
        <button type="button" onClick={copy} aria-label="Copy website code" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-input hover:bg-secondary">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
