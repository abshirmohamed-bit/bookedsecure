/**
 * Pure helpers for email campaigns. No I/O here so the rules (who may be
 * emailed, how the email is rendered) can be tested without a database.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resend's shared onboarding address only delivers to the account owner. */
export const SHARED_FROM_ADDRESS = "onboarding@resend.dev";

export type EmailableLead = {
  id: string;
  name: string | null;
  email: string | null;
  deleted_at?: string | null;
};

export type RecipientSplit = {
  emailable: { leadId: string; email: string }[];
  skippedNoEmail: string[];
  skippedUnsubscribed: string[];
  skippedDuplicate: string[];
};

/**
 * Decide who a campaign may go to. A lead is skipped when it has no usable
 * email address, has unsubscribed, or appears twice (first occurrence wins).
 */
export function splitRecipients(
  leads: EmailableLead[],
  unsubscribedEmails: ReadonlySet<string>,
): RecipientSplit {
  const emailable: { leadId: string; email: string }[] = [];
  const skippedNoEmail: string[] = [];
  const skippedUnsubscribed: string[] = [];
  const skippedDuplicate: string[] = [];
  const seen = new Set<string>();

  for (const lead of leads) {
    if (lead.deleted_at) continue;
    const email = (lead.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      skippedNoEmail.push(lead.id);
      continue;
    }
    if (unsubscribedEmails.has(email)) {
      skippedUnsubscribed.push(lead.id);
      continue;
    }
    if (seen.has(email)) {
      skippedDuplicate.push(lead.id);
      continue;
    }
    seen.add(email);
    emailable.push({ leadId: lead.id, email });
  }
  return { emailable, skippedNoEmail, skippedUnsubscribed, skippedDuplicate };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Render the plain-text body the owner wrote into a simple, safe HTML email.
 * Owner text is always escaped; the only link is the unsubscribe footer.
 */
export function buildEmailHtml(input: {
  businessName: string;
  bodyText: string;
  unsubscribeUrl: string;
}): string {
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:15px;line-height:1.6;">
    <div style="max-width:560px;margin:0 auto;">
      ${paragraphs}
      <hr style="border:none;border-top:1px solid #e4e7eb;margin:24px 0;">
      <p style="font-size:12px;color:#6b7280;">
        Sent by ${escapeHtml(input.businessName)}.
        <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe from these emails</a>.
      </p>
    </div>
  </body>
</html>`;
}

/** True when the from address can actually reach customers. */
export function isDeliverableFromAddress(fromAddress: string): boolean {
  return fromAddress.trim().toLowerCase() !== SHARED_FROM_ADDRESS;
}

export function normaliseFromAddress(fromAddress: string | null | undefined): string {
  const value = (fromAddress ?? "").trim();
  return EMAIL_RE.test(value) ? value.toLowerCase() : SHARED_FROM_ADDRESS;
}

/* ---------- Audiences, follow-ups and results (Explee-style sequences) ---------- */

/** Quick audiences: lead statuses each one covers (null means every customer). */
export const CAMPAIGN_AUDIENCES = [
  { id: "all", label: "Everyone with an email", statuses: null },
  {
    id: "enquiries",
    label: "Open enquiries",
    statuses: ["new", "previous_lead", "contacted", "waiting_for_customer", "customer_replied", "ready_for_quote"],
  },
  { id: "quoted", label: "Quoted, not booked", statuses: ["quote_sent"] },
  { id: "booked", label: "Booked", statuses: ["scheduled"] },
  { id: "past", label: "Past customers", statuses: ["completed"] },
  { id: "lost", label: "Lost leads", statuses: ["lost"] },
] as const;

export type CampaignAudienceId = (typeof CAMPAIGN_AUDIENCES)[number]["id"];

/** Statuses that may never be emailed by a campaign, whatever the audience. */
export const NEVER_EMAIL_STATUSES = ["opted_out", "invalid"] as const;

const DAY_MS = 86_400_000;

/** A follow-up is due once its delay has passed since the first email. */
export function followUpDue(sentAt: string | null, delayDays: number | null, now: Date): boolean {
  if (!sentAt || !delayDays) return false;
  const sent = Date.parse(sentAt);
  return Number.isFinite(sent) && now.getTime() - sent >= delayDays * DAY_MS;
}

/** Why a follow-up must not go out, or null when it may be sent. */
export function followUpSkipReason(input: {
  unsubscribed: boolean;
  leadDeleted: boolean;
  bookedSinceFirstEmail: boolean;
  stopOnBooking: boolean;
  campaignStatus: string;
}): string | null {
  if (input.campaignStatus !== "sent") return "Campaign is not sent";
  if (input.unsubscribed) return "Unsubscribed";
  if (input.leadDeleted) return "Customer was deleted";
  if (input.stopOnBooking && input.bookedSinceFirstEmail) return "Booked after the first email";
  return null;
}

/** Bookings count toward a campaign when made within this many days of its email. */
export const ATTRIBUTION_DAYS = 30;

/**
 * Recipients who booked after receiving the campaign (within ATTRIBUTION_DAYS),
 * counted once per recipient. Cancelled jobs never count.
 */
export function bookedRecipients(
  recipients: { leadId: string | null; sentAt: string | null }[],
  jobs: { lead_id: string; created_at: string; completion_status: string }[],
): Set<string> {
  const byLead = new Map<string, number[]>();
  for (const job of jobs) {
    if (job.completion_status === "cancelled") continue;
    const at = Date.parse(job.created_at);
    if (!Number.isFinite(at)) continue;
    byLead.set(job.lead_id, [...(byLead.get(job.lead_id) ?? []), at]);
  }
  const booked = new Set<string>();
  for (const r of recipients) {
    if (!r.leadId || !r.sentAt) continue;
    const sent = Date.parse(r.sentAt);
    if ((byLead.get(r.leadId) ?? []).some((at) => at >= sent && at - sent <= ATTRIBUTION_DAYS * DAY_MS)) {
      booked.add(r.leadId);
    }
  }
  return booked;
}

/** A schedule time must be at least 5 minutes ahead and within 60 days. */
export function scheduleTimeProblem(at: Date, now: Date): string | null {
  if (Number.isNaN(at.getTime())) return "Choose a valid date and time.";
  if (at.getTime() < now.getTime() + 5 * 60_000) return "Choose a time at least 5 minutes from now.";
  if (at.getTime() > now.getTime() + 60 * DAY_MS) return "Choose a time within the next 60 days.";
  return null;
}

/** Reads the AI's "SUBJECT: … BODY: …" reply; strips any bracketed placeholders. */
export function parseCampaignDraft(text: string): { subject: string; bodyText: string } | null {
  const match = text.match(/SUBJECT:\s*(.+?)\s*\n+\s*BODY:\s*\n?([\s\S]+)/i);
  if (!match) return null;
  const subject = match[1]!.trim().replace(/^"|"$/g, "").slice(0, 160);
  const bodyText = match[2]!.trim().replace(/[{}[\]]/g, "").slice(0, 5000);
  return subject && bodyText ? { subject, bodyText } : null;
}
