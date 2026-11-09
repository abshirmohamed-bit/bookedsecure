import { useState } from "react";
import { Loader2, Mail, Repeat2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmailPreview } from "@/components/campaigns/CampaignParts";
import { cn } from "@/lib/utils";
import { SHARED_FROM_ADDRESS } from "@/lib/email-campaigns";
import { updateEmailCampaign } from "@/lib/email-campaigns.functions";

const DELAYS = [2, 3, 5, 7, 14];

export type EditableCampaign = {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  fromAddress: string;
  followUp: { subject: string; bodyText: string; delayDays: number; stopOnBooking: boolean } | null;
};

/** Edit a draft or scheduled campaign: wording, follow-up and reply-to address, with a live preview. */
export function CampaignEditor({
  campaign,
  businessName,
  onCancel,
  onSaved,
}: {
  campaign: EditableCampaign;
  businessName: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [subject, setSubject] = useState(campaign.subject);
  const [bodyText, setBodyText] = useState(campaign.bodyText);
  const [replyTo, setReplyTo] = useState(campaign.fromAddress === SHARED_FROM_ADDRESS ? "" : campaign.fromAddress);
  const [followUpOn, setFollowUpOn] = useState(Boolean(campaign.followUp));
  const [followSubject, setFollowSubject] = useState(campaign.followUp?.subject ?? "");
  const [followBody, setFollowBody] = useState(campaign.followUp?.bodyText ?? "");
  const [delayDays, setDelayDays] = useState(campaign.followUp?.delayDays ?? 3);
  const [stopOnBooking, setStopOnBooking] = useState(campaign.followUp?.stopOnBooking ?? true);
  const [tab, setTab] = useState<"first" | "follow_up">("first");
  const [saving, setSaving] = useState(false);

  const followReady = !followUpOn || (followSubject.trim().length >= 2 && followBody.trim().length >= 2);
  const valid = name.trim().length >= 2 && subject.trim().length >= 2 && bodyText.trim().length >= 2 && followReady;

  async function save() {
    if (!valid) {
      toast.error(!followReady ? "Finish the follow-up, or turn it off." : "Add a name, subject and email.");
      return;
    }
    setSaving(true);
    try {
      await updateEmailCampaign({
        data: {
          campaignId: campaign.id,
          name: name.trim(),
          subject: subject.trim(),
          bodyText: bodyText.trim(),
          replyTo: replyTo.trim() || null,
          followUp: followUpOn ? { subject: followSubject.trim(), bodyText: followBody.trim(), delayDays, stopOnBooking } : null,
        },
      });
      toast.success("Campaign updated.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const showFollow = tab === "follow_up" && followUpOn;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="glass space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Edit campaign</h2>
          <button type="button" onClick={onCancel} className="grid size-8 place-items-center rounded-full hover:bg-white/70" aria-label="Stop editing">
            <X className="size-4" />
          </button>
        </div>
        <label className="block space-y-1.5 text-xs font-medium">
          Campaign name <span className="font-normal text-muted-foreground">(only you see this)</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>

        <div className="inline-flex rounded-xl border border-white/70 bg-white/45 p-1" role="tablist">
          {([
            ["first", "First email", Mail],
            ["follow_up", followUpOn ? `Follow-up · ${delayDays}d` : "Follow-up", Repeat2],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", tab === value ? "bg-white/95 text-primary shadow-sm" : "text-muted-foreground")}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "first" ? (
          <>
            <Input aria-label="Subject line" placeholder="Subject line" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} className="h-11 font-medium" />
            <Textarea aria-label="Email" rows={10} value={bodyText} onChange={(e) => setBodyText(e.target.value)} maxLength={5000} />
          </>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={followUpOn} onChange={(e) => setFollowUpOn(e.target.checked)} />
              Send a follow-up to customers who don't book
            </label>
            {followUpOn && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Send after</span>
                  {DELAYS.map((d) => (
                    <button key={d} type="button" onClick={() => setDelayDays(d)} className={cn("rounded-md px-2 py-1 font-medium", delayDays === d ? "bg-primary text-primary-foreground" : "bg-white/70 hover:bg-white")}>
                      {d}d
                    </button>
                  ))}
                  <label className="ml-2 inline-flex items-center gap-1.5 text-muted-foreground">
                    <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={stopOnBooking} onChange={(e) => setStopOnBooking(e.target.checked)} />
                    Skip customers who book
                  </label>
                </div>
                <Input aria-label="Follow-up subject" placeholder="Follow-up subject" value={followSubject} onChange={(e) => setFollowSubject(e.target.value)} maxLength={160} />
                <Textarea aria-label="Follow-up email" rows={7} value={followBody} onChange={(e) => setFollowBody(e.target.value)} maxLength={5000} placeholder="A short nudge for customers who haven't booked…" />
              </>
            )}
          </div>
        )}

        <label className="block space-y-1.5 text-xs font-medium">
          Reply-to address <span className="font-normal text-muted-foreground">(optional)</span>
          <Input type="email" placeholder="Your own email, for a copy of replies" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} maxLength={200} />
          <span className="block font-normal text-muted-foreground">Replies show under Campaigns → Replies, and a copy goes here (or to your login email if blank).</span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save changes
          </Button>
        </div>
      </div>
      <EmailPreview
        businessName={businessName}
        fromAddress=""
        subject={showFollow ? followSubject : subject}
        bodyText={showFollow ? followBody : bodyText}
        label={showFollow ? "Follow-up customers get" : "What customers get"}
      />
    </div>
  );
}
