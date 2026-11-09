/**
 * The whole email campaign workflow as one set of typed actions, shared by the
 * in-app Assistant (Cowork) and external assistants (ChatGPT, Claude via MCP):
 * audience, writing, drafting, editing recipients and wording, previewing,
 * sending, scheduling, cancelling and stopping follow-ups.
 *
 * Sending and scheduling need a confirmation code from previewSend. The code
 * is derived from the campaign exactly as it will go out (wording, follow-up,
 * recipients), so any change after the preview invalidates it and the owner
 * has to see a fresh summary. Assistants must show that summary and get the
 * owner's explicit yes before using the code.
 */
import { CAMPAIGN_AUDIENCES, type CampaignAudienceId } from "@/lib/email-campaigns";
import {
  campaignAudience,
  cancelEmailCampaign,
  createEmailCampaign,
  draftCampaignEmail,
  getEmailCampaign,
  listEmailCampaigns,
  scheduleEmailCampaign,
  sendEmailCampaign,
  stopCampaignFollowUps,
  unscheduleEmailCampaign,
  updateEmailCampaignDraft,
} from "@/lib/email-campaigns.server";

export type CampaignActor = { businessId: string; userId: string };
export type FollowUpInput = { subject: string; bodyText: string; delayDays: number; stopOnBooking?: boolean | undefined };

const audienceLabel = (id: CampaignAudienceId) => CAMPAIGN_AUDIENCES.find((a) => a.id === id)?.label ?? id;

function confirmSecret(): string {
  return process.env["EMAIL_SEND_CONFIRM_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["LOVABLE_API_KEY"] ?? "bookedsecure";
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Campaign = Awaited<ReturnType<typeof getEmailCampaign>>;

/** A short code tied to exactly what will be sent. Changes whenever the campaign does. */
export async function confirmationCodeFor(campaign: Pick<Campaign, "id" | "status" | "subject" | "bodyText" | "followUp" | "fromAddress" | "recipients">): Promise<string> {
  const pending = campaign.recipients.filter((r) => r.status === "pending" || r.status === "failed").map((r) => r.email).sort();
  const fingerprint = JSON.stringify([campaign.id, campaign.status, campaign.subject, campaign.bodyText, campaign.followUp, campaign.fromAddress, pending]);
  return (await sha256Hex(`${confirmSecret()}|${fingerprint}`)).slice(0, 8).toUpperCase();
}

async function resolveLeadIds(actor: CampaignActor, input: { audience?: CampaignAudienceId | null | undefined; leadIds?: string[] | null | undefined }) {
  if (input.audience) {
    const leads = await campaignAudience(actor.businessId, input.audience);
    if (!leads.length) throw new Error(`Nobody in "${audienceLabel(input.audience)}" has an email address.`);
    if (leads.length > 500) throw new Error(`"${audienceLabel(input.audience)}" has ${leads.length} customers; a campaign can go to 500 at most.`);
    return { leadIds: leads.map((l) => l.id), label: audienceLabel(input.audience) };
  }
  if (input.leadIds?.length) return { leadIds: input.leadIds, label: null };
  return null;
}

function summarise(c: Campaign) {
  return {
    campaignId: c.id,
    name: c.name,
    status: c.status,
    subject: c.subject,
    body: c.bodyText,
    followUp: c.followUp ? { afterDays: c.followUp.delayDays, subject: c.followUp.subject, body: c.followUp.bodyText, skipsCustomersWhoBook: c.followUp.stopOnBooking } : null,
    audience: c.audienceLabel,
    scheduledAt: c.scheduledAt,
    sentAt: c.sentAt,
    recipients: {
      total: c.counts.total,
      waitingToSend: c.counts.pending,
      sent: c.counts.sent,
      failed: c.counts.failed,
      people: c.recipients.slice(0, 50).map((r) => ({ leadId: r.leadId, name: r.name, email: r.email, status: r.status, followUp: r.followUpStatus, booked: r.booked })),
    },
    results: { followUpsSent: c.counts.followUpsSent, followUpsWaiting: c.counts.followUpsWaiting, bookedAfterEmail: c.counts.booked },
  };
}

export const campaignActions = {
  async audience(actor: CampaignActor, input: { audience: CampaignAudienceId }) {
    const leads = await campaignAudience(actor.businessId, input.audience);
    return { audience: audienceLabel(input.audience), count: leads.length, sample: leads.slice(0, 15).map((l) => ({ leadId: l.id, name: l.name, email: l.email })) };
  },

  async write(actor: CampaignActor, input: { kind: "first" | "follow_up"; instructions: string; style?: string[] | undefined; firstEmail?: { subject: string; bodyText: string } | null | undefined }) {
    return draftCampaignEmail({ businessId: actor.businessId, kind: input.kind, instructions: input.instructions, chips: input.style ?? [], firstEmail: input.firstEmail ?? null });
  },

  async create(actor: CampaignActor, input: { name: string; subject: string; bodyText: string; audience?: CampaignAudienceId | null | undefined; leadIds?: string[] | null | undefined; followUp?: FollowUpInput | null | undefined; replyTo?: string | null | undefined }) {
    const recipients = await resolveLeadIds(actor, input);
    if (!recipients) throw new Error("Say who the campaign is for: an audience or named customers.");
    const result = await createEmailCampaign({
      businessId: actor.businessId, userId: actor.userId, name: input.name, subject: input.subject, bodyText: input.bodyText,
      fromAddress: input.replyTo ?? null, leadIds: recipients.leadIds, audienceLabel: recipients.label,
      followUp: input.followUp ? { ...input.followUp, stopOnBooking: input.followUp.stopOnBooking ?? true } : null,
    });
    const campaign = await getEmailCampaign(actor.businessId, result.campaignId);
    return { ...summarise(campaign), skippedNoEmail: result.skippedNoEmail, skippedUnsubscribed: result.skippedUnsubscribed, nextStep: "Show the owner the draft. To send, call the preview step for a confirmation code." };
  },

  async update(actor: CampaignActor, input: {
    campaignId: string; name?: string | null | undefined; subject?: string | null | undefined; bodyText?: string | null | undefined; replyTo?: string | null | undefined;
    followUp?: FollowUpInput | null | undefined; removeFollowUp?: boolean | null | undefined;
    addLeadIds?: string[] | null | undefined; removeLeadIds?: string[] | null | undefined; replaceWithAudience?: CampaignAudienceId | null | undefined;
  }) {
    const replace = input.replaceWithAudience ? await resolveLeadIds(actor, { audience: input.replaceWithAudience }) : null;
    const result = await updateEmailCampaignDraft({
      businessId: actor.businessId, campaignId: input.campaignId,
      name: input.name ?? null, subject: input.subject ?? null, bodyText: input.bodyText ?? null,
      ...(input.replyTo !== undefined && input.replyTo !== null ? { replyTo: input.replyTo } : {}),
      ...(input.removeFollowUp ? { followUp: null } : input.followUp ? { followUp: { ...input.followUp, stopOnBooking: input.followUp.stopOnBooking ?? true } } : {}),
      ...(replace ? { replaceLeadIds: replace.leadIds, audienceLabel: replace.label } : { addLeadIds: input.addLeadIds ?? [], removeLeadIds: input.removeLeadIds ?? [] }),
    });
    return { ...summarise(result.campaign), added: result.added, removed: result.removed, skippedNoEmail: result.skippedNoEmail, skippedUnsubscribed: result.skippedUnsubscribed };
  },

  async list(actor: CampaignActor, input: { limit?: number | undefined }) {
    const list = await listEmailCampaigns(actor.businessId);
    return {
      campaigns: list.slice(0, input.limit ?? 10).map((c) => ({
        campaignId: c.id, name: c.name, subject: c.subject, status: c.status, audience: c.audienceLabel,
        createdAt: c.createdAt, scheduledAt: c.scheduledAt, sentAt: c.sentAt,
        recipients: c.counts.total, waitingToSend: c.counts.pending, sent: c.counts.sent, failed: c.counts.failed,
        followUp: c.followUp ? { afterDays: c.followUp.delayDays, sent: c.counts.followUpsSent, waiting: c.counts.followUpsWaiting } : null,
        bookedAfterEmail: c.counts.booked,
      })),
    };
  },

  async details(actor: CampaignActor, input: { campaignId: string }) {
    return summarise(await getEmailCampaign(actor.businessId, input.campaignId));
  },

  /** What will go out, plus the code needed to send or schedule exactly this. */
  async previewSend(actor: CampaignActor, input: { campaignId: string }) {
    const campaign = await getEmailCampaign(actor.businessId, input.campaignId);
    if (!["draft", "scheduled"].includes(campaign.status)) throw new Error(`This campaign is ${campaign.status}, so it can't be sent again.`);
    if (campaign.counts.pending + campaign.counts.failed === 0) throw new Error("Nobody is waiting to receive this campaign.");
    const people = campaign.recipients.filter((r) => r.status === "pending" || r.status === "failed");
    return {
      confirmationCode: await confirmationCodeFor(campaign),
      summary: {
        name: campaign.name,
        subject: campaign.subject,
        body: campaign.bodyText,
        recipients: people.length,
        firstRecipients: people.slice(0, 10).map((r) => r.name ?? r.email),
        followUp: campaign.followUp ? `Follow-up "${campaign.followUp.subject}" after ${campaign.followUp.delayDays} days${campaign.followUp.stopOnBooking ? " to customers who haven't booked" : ""}` : "No follow-up",
        sender: "Sent under the business name from campaigns@bookedsecure.com; replies go to the business.",
      },
      instructions: "Show this summary to the owner and ask them to confirm. Only after they clearly say yes, call send (or schedule) with this confirmationCode. If anything changes, preview again.",
    };
  },

  async send(actor: CampaignActor, input: { campaignId: string; confirmationCode: string }) {
    const campaign = await getEmailCampaign(actor.businessId, input.campaignId);
    if (input.confirmationCode.trim().toUpperCase() !== (await confirmationCodeFor(campaign))) {
      throw new Error("The campaign changed or the confirmation code is wrong. Preview it again and confirm with the owner.");
    }
    const result = await sendEmailCampaign({ businessId: actor.businessId, campaignId: input.campaignId });
    return { sent: result.sent, failed: result.failed, skippedUnsubscribed: result.skipped, status: result.sent > 0 ? "sent" : "not sent" };
  },

  async schedule(actor: CampaignActor, input: { campaignId: string; sendAt: string; confirmationCode: string }) {
    const campaign = await getEmailCampaign(actor.businessId, input.campaignId);
    if (input.confirmationCode.trim().toUpperCase() !== (await confirmationCodeFor(campaign))) {
      throw new Error("The campaign changed or the confirmation code is wrong. Preview it again and confirm with the owner.");
    }
    return scheduleEmailCampaign({ businessId: actor.businessId, campaignId: input.campaignId, scheduledAt: input.sendAt });
  },

  async unschedule(actor: CampaignActor, input: { campaignId: string }) {
    return unscheduleEmailCampaign({ businessId: actor.businessId, campaignId: input.campaignId });
  },

  async cancel(actor: CampaignActor, input: { campaignId: string }) {
    return cancelEmailCampaign({ businessId: actor.businessId, campaignId: input.campaignId });
  },

  async stopFollowUps(actor: CampaignActor, input: { campaignId: string }) {
    return stopCampaignFollowUps({ businessId: actor.businessId, campaignId: input.campaignId });
  },
};

export type CampaignActionName = keyof typeof campaignActions;
