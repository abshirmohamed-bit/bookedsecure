/**
 * BookedSecure's default email template, used for every email a business
 * sends through BookedSecure (campaigns, follow-ups, one-off emails).
 *
 * Built the way email clients need: table layout, inline styles, a fixed
 * 600px card on a soft background (so it reads as a designed message rather
 * than text floating in a wide window), a hidden preview line, and a plain
 * text twin for spam filters and text-only clients. All owner text is escaped.
 * A business's own look (lib/email-theme: colours, font, logo, buttons,
 * footer line) is applied through `theme`; it never adds HTML.
 */
import { resolveEmailLook, type EmailTheme } from "@/lib/email-theme";

export type EmailBranding = {
  businessName: string;
  /** Public URL of the business logo, when it has one. */
  logoUrl?: string | null;
  websiteUrl?: string | null;
  serviceArea?: string | null;
  abn?: string | null;
  /** The business's email template (businesses.email_theme). */
  theme?: EmailTheme | null;
};

export type EmailContent = {
  /** The owner's plain text. Blank lines separate paragraphs. */
  bodyText: string;
  /** Optional large heading above the body. */
  heading?: string | null;
  /** Optional button, e.g. { label: "Get a quote", url }. */
  cta?: { label: string; url: string } | null;
  /** Unsubscribe link: required for marketing email. */
  unsubscribeUrl?: string | null;
  /** Preview text shown next to the subject in the inbox. Defaults to the first line. */
  preheader?: string | null;
};

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function paragraphs(bodyText: string): string[] {
  return bodyText.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "B";
}

export function renderEmailHtml(brand: EmailBranding, content: EmailContent): string {
  const C = resolveEmailLook(brand.theme);
  const FONT = C.font;
  const name = escapeHtml(brand.businessName);
  const logo = C.showLogo ? safeUrl(brand.logoUrl) : null;
  const website = safeUrl(brand.websiteUrl);
  const cta = content.cta ? { label: escapeHtml(content.cta.label), url: safeUrl(content.cta.url) } : null;
  const blocks = paragraphs(content.bodyText);
  const preheader = escapeHtml((content.preheader ?? blocks.find((b) => !/^hi\b|^hello\b|^dear\b/i.test(b)) ?? blocks[0] ?? "").replace(/\s+/g, " ").slice(0, 140));
  const unsubscribe = safeUrl(content.unsubscribeUrl);

  const mark = logo
    ? `<img src="${escapeHtml(logo)}" width="40" height="40" alt="${name}" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:contain;border:0;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border-radius:10px;background:${C.brand};color:${C.buttonText};font:600 15px ${FONT};">${escapeHtml(initials(brand.businessName))}</td></tr></table>`;

  const body = blocks
    .map((block) => `<p style="margin:0 0 16px;font:400 16px/1.65 ${FONT};color:${C.body};">${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("\n");

  const button = cta?.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;"><tr><td align="center" bgcolor="${C.brand}" style="border-radius:${C.buttonRadius};background:${C.brand};">
         <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 26px;font:600 15px ${FONT};color:${C.buttonText};text-decoration:none;border-radius:${C.buttonRadius};">${cta.label}</a>
       </td></tr></table>`
    : "";

  const details = [escapeHtml(brand.serviceArea ?? "").trim() || null, website ? `<a href="${escapeHtml(website)}" style="color:${C.muted};text-decoration:underline;">${escapeHtml(website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : null, brand.abn ? `ABN ${escapeHtml(brand.abn)}` : null]
    .filter(Boolean)
    .join(" &middot; ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${name}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.border};border-radius:${C.cardRadius};overflow:hidden;">
      <tr><td${C.logoAlign === "center" ? ' align="center"' : ""} style="padding:22px 32px;border-bottom:1px solid ${C.border};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"${C.logoAlign === "center" ? ' align="center"' : ""}><tr>
          ${C.showLogo ? `<td valign="middle" style="padding-right:12px;">${mark}</td>` : ""}
          <td valign="middle" style="font:600 17px ${FONT};color:${C.ink};">${name}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 32px 16px;">
        ${content.heading ? `<h1 style="margin:0 0 18px;font:600 24px/1.25 ${FONT};color:${C.ink};letter-spacing:-0.01em;">${escapeHtml(content.heading)}</h1>` : ""}
        ${body}
        ${button}
      </td></tr>
      <tr><td style="padding:20px 32px 24px;background:${C.footer};border-top:1px solid ${C.border};">
        <p style="margin:0;font:600 13px ${FONT};color:${C.ink};">${name}</p>
        ${details ? `<p style="margin:4px 0 0;font:400 12px/1.5 ${FONT};color:${C.muted};">${details}</p>` : ""}
        ${C.footerNote ? `<p style="margin:8px 0 0;font:400 12px/1.5 ${FONT};color:${C.muted};">${escapeHtml(C.footerNote).replaceAll("\n", "<br>")}</p>` : ""}
        <p style="margin:12px 0 0;font:400 12px/1.5 ${FONT};color:${C.muted};">Reply to this email to get in touch with ${name}.</p>
      </td></tr>
    </table>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td align="center" style="padding:18px 24px 0;font:400 11px/1.6 ${FONT};color:${C.muted};">
        You're receiving this email because you've been in touch with ${name}.${unsubscribe ? `<br><a href="${escapeHtml(unsubscribe)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe from these emails</a>` : ""}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Plain-text twin of the HTML email. */
export function renderEmailText(brand: EmailBranding, content: EmailContent): string {
  const website = safeUrl(brand.websiteUrl);
  return [
    content.heading ?? null,
    paragraphs(content.bodyText).join("\n\n"),
    content.cta && safeUrl(content.cta.url) ? `${content.cta.label}: ${safeUrl(content.cta.url)}` : null,
    "--",
    [brand.businessName, brand.serviceArea, website, brand.abn ? `ABN ${brand.abn}` : null].filter(Boolean).join(" · "),
    resolveEmailLook(brand.theme).footerNote,
    content.unsubscribeUrl ? `Unsubscribe: ${content.unsubscribeUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
