/**
 * Replies in the customer's own language. Many customers write in Arabic,
 * Turkish, Dari, Persian, Mandarin, Vietnamese and more; drafts answer in the
 * same language, and the owner gets an English line so they always know what
 * they're approving. Only the reply itself is ever sent.
 */

export const MATCH_CUSTOMER_LANGUAGE =
  "Write the reply in the same language the customer wrote in (for example Arabic, Turkish, Dari, Persian, Mandarin or Vietnamese). If they wrote in English, or the language is unclear, use plain Australian English.";

export const OWNER_TRANSLATION_LINE =
  'If the reply is not in English, add one last line that starts with "EN:" and gives its meaning in English for the business owner. Never add that line to an English reply.';

/** Splits a draft into the reply to send and the owner's English meaning (if any). */
export function splitOwnerTranslation(text: string): { reply: string; english: string | null } {
  const lines = text.trim().split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*EN\s*:/i.test(l));
  if (idx === -1) return { reply: text.trim(), english: null };
  const english = lines.slice(idx).join(" ").replace(/^\s*EN\s*:\s*/i, "").trim();
  const reply = lines.slice(0, idx).join("\n").trim();
  return { reply, english: english || null };
}
