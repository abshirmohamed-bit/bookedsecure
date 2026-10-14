import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelEmailCampaign,
  createEmailCampaign,
  getEmailCampaigns,
  searchCampaignLeads,
  sendEmailCampaign,
} from "@/lib/email-campaigns.functions";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Email campaigns | BookedSecure" },
      {
        name: "description",
        content:
          "Draft email campaigns to your customers, review them, and send when ready. Unsubscribed customers are always skipped.",
      },
      { property: "og:title", content: "Email campaigns | BookedSecure" },
      {
        property: "og:description",
        content: "Draft, review and send email campaigns to your customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignsPage,
});

type Campaign = Awaited<ReturnType<typeof getEmailCampaigns>>[number];
type LeadOption = Awaited<ReturnType<typeof searchCampaignLeads>>[number];

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [selected, setSelected] = useState<Map<string, LeadOption>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCampaigns(await getEmailCampaigns());
    } catch {
      toast.error("Could not load email campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setLeadOptions(await searchCampaignLeads({ data: { query: leadQuery } }));
      } catch {
        // Search is best-effort; the selected recipients stay put.
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [leadQuery]);

  async function onCreate() {
    if (selected.size === 0) {
      toast.error("Pick at least one customer to email.");
      return;
    }
    setBusy(true);
    try {
      const result = await createEmailCampaign({
        data: {
          name,
          subject,
          bodyText,
          fromAddress: fromAddress || null,
          leadIds: [...selected.keys()],
        },
      });
      toast.success(
        `Draft saved for ${result.emailable} customer${result.emailable === 1 ? "" : "s"}` +
          (result.skippedUnsubscribed > 0
            ? ` (${result.skippedUnsubscribed} unsubscribed skipped)`
            : "") +
          (result.skippedNoEmail > 0 ? ` (${result.skippedNoEmail} without an email skipped)` : ""),
      );
      if (!result.fromDeliverable) {
        toast.warning(
          "Emails will only reach your own inbox until your sending domain is verified with the email provider..",
        );
      }
      setName("");
      setSubject("");
      setBodyText("");
      setSelected(new Map());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  async function onSend(campaign: Campaign) {
    if (
      !window.confirm(
        `Send "${campaign.name}" to ${campaign.counts.pending} customer${campaign.counts.pending === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await sendEmailCampaign({ data: { campaignId: campaign.id } });
      toast.success(
        `Sent ${result.sent} email${result.sent === 1 ? "" : "s"}` +
          (result.failed > 0 ? `, ${result.failed} failed` : "") +
          (result.skipped > 0 ? `, ${result.skipped} unsubscribed skipped` : ""),
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the campaign.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(campaign: Campaign) {
    if (!window.confirm(`Cancel the draft "${campaign.name}"?`)) return;
    setBusy(true);
    try {
      await cancelEmailCampaign({ data: { campaignId: campaign.id } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Email campaigns">
      <div className="mx-auto max-w-3xl space-y-8 p-4">
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5" /> New email campaign
          </h2>
          <p className="text-sm text-muted-foreground">
            Write the email, pick the customers, and save it as a draft. Nothing is sent until you
            press Send on the draft below. Every email includes an unsubscribe link, and customers
            who unsubscribed are always skipped.
          </p>
          <Input placeholder="Campaign name (only you see this)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Subject line" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Textarea
            placeholder="Write the email in your own words..."
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={6}
          />
          <Input
            placeholder="From address (optional, e.g. hello@yourbusiness.com.au)"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Until your own sending domain is verified with the email provider, emails only reach
            your own inbox..
          </p>

          <div className="space-y-2">
            <Input
              placeholder="Search customers by name or email..."
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
            />
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-2">
                {[...selected.values()].map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    className="rounded-full bg-secondary px-3 py-1 text-xs"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Map(prev);
                        next.delete(lead.id);
                        return next;
                      })
                    }
                  >
                    {lead.name ?? lead.email} ×
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {leadOptions.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No customers found.</p>
              )}
              {leadOptions.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  disabled={!lead.email || selected.has(lead.id)}
                  onClick={() => setSelected((prev) => new Map(prev).set(lead.id, lead))}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
                >
                  <span>{lead.name ?? "Unnamed"}</span>
                  <span className="text-xs text-muted-foreground">
                    {lead.email ?? "no email"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Button onClick={onCreate} disabled={busy || !name.trim() || !subject.trim() || !bodyText.trim()}>
            Save draft
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your campaigns</h2>
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!loading && campaigns.length === 0 && (
            <p className="text-sm text-muted-foreground">No email campaigns yet.</p>
          )}
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{campaign.name}</p>
                  <p className="text-sm text-muted-foreground">Subject: {campaign.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.status === "sent"
                      ? `Sent ${campaign.counts.sent} of ${campaign.counts.total}`
                      : campaign.status === "cancelled"
                        ? "Cancelled"
                        : `Draft · ${campaign.counts.pending} recipient${campaign.counts.pending === 1 ? "" : "s"}`}
                    {campaign.counts.failed > 0 ? ` · ${campaign.counts.failed} failed` : ""}
                  </p>
                  {!campaign.fromDeliverable && campaign.status !== "cancelled" && (
                    <p className="text-xs text-amber-600">
                      Sending domain not verified — emails only reach your own inbox for now.
                    </p>
                  )}
                </div>
                {campaign.status === "draft" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onSend(campaign)} disabled={busy}>
                      <Send className="mr-1 h-4 w-4" /> Send
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onCancel(campaign)}
                      disabled={busy}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Cancel
                    </Button>
                  </div>
                )}
              </div>
              {campaign.recipients.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Recipients</summary>
                  <ul className="mt-1 space-y-0.5">
                    {campaign.recipients.map((r) => (
                      <li key={r.email}>
                        {r.email} — {r.status}
                        {r.error ? ` (${r.error})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
