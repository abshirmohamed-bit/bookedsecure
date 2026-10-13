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
