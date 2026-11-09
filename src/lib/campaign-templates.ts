/**
 * Starter wording for email campaigns and the preview helpers the composer
 * uses. Pure so the preview always matches how buildEmailHtml splits text.
 */

export type CampaignTemplate = {
  id: string;
  label: string;
  name: string;
  subject: string;
  body: (businessName: string | null) => string;
};

const signOff = (businessName: string | null) => (businessName ? `Thanks,\n${businessName}` : "Thanks,");

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "openings",
    label: "Openings this week",
    name: "Openings this week",
    subject: "We have a few openings this week",
    body: (b) =>
      `Hi there,\n\nWe've had a couple of spots open up this week and wanted to let you know first.\n\nReply to this email and we'll lock in a time that suits you.\n\n${signOff(b)}`,
  },
  {
    id: "seasonal",
    label: "Seasonal special",
    name: "Seasonal special",
    subject: "A fresh start for the new season",
    body: (b) =>
      `Hi there,\n\nThe season is changing, and it's a great time to book in before things get busy.\n\nReply to this email to grab a time, and we'll take care of the rest.\n\n${signOff(b)}`,
  },
  {
    id: "miss-you",
    label: "It's been a while",
    name: "Win back past customers",
    subject: "It's been a while",
    body: (b) =>
      `Hi there,\n\nIt's been a while since we last saw you, and we'd love to help again.\n\nIf you'd like to book in, just reply to this email with a day that works.\n\n${signOff(b)}`,
  },
  {
    id: "thanks",
    label: "Thank you",
    name: "Thank you",
    subject: "Thank you for choosing us",
    body: (b) =>
      `Hi there,\n\nThank you for choosing us. It means a lot to a local business like ours.\n\nIf you were happy with the job, a quick reply or a review would make our day.\n\n${signOff(b)}`,
  },
];

/** Same paragraph split as buildEmailHtml: blank lines separate paragraphs. */
export function previewParagraphs(bodyText: string): string[][] {
  return bodyText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.split("\n"));
}

/** Two-letter initials for a customer avatar. */
export function initials(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : source.slice(0, 2);
  return letters.toUpperCase();
}
