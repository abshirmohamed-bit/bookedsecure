// Pure rules for the automatic reply to a Facebook Lead Ads submission.
// Facebook leads carry no SMS consent, so exactly ONE reply about the
// customer's own enquiry is allowed (with an opt-out line) — never follow-ups.
import { localDateTimeToIso } from './business-time';
import type { RawAnswer } from './lead-sync';

/** Only submissions made after this moment get an automatic reply; older imports are never texted. */
export const FACEBOOK_AUTO_REPLY_FROM = '2026-11-07T14:35:00.000Z';

export type FacebookIntent = 'quote' | 'booking';
export type Classification = { intent: FacebookIntent; requestedAt: string | null };

const BOOKING_WORDS = /\b(book|booking|booked|appointment|schedule|reserve)\b/i;
const QUOTE_WORDS = /\b(quote|price|pricing|cost|how much|estimate)\b/i;

function answersText(answers: RawAnswer[]): string {
  return answers.map((a) => `${a.name.replace(/_/g, ' ')}: ${a.values.join(', ')}`).join('\n');
}

function to24(hour: number, minute: number, ampm: string | undefined): [number, number] | null {
  let h = hour;
  if (ampm) {
    const pm = ampm.toLowerCase() === 'pm';
    if (h < 1 || h > 12) return null;
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || minute > 59) return null;
  return [h, minute];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Reads an exact date AND time only (e.g. "2026-11-12 10:00", "12/11/2026 9:30am").
 * Vague timing such as "next week" or "ASAP" returns null — never guessed.
 */
export function parseExactDateTime(text: string, timeZone: string, now: Date): string | null {
  const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const iso = /(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(text);
  const au = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b[ ,at]*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  let y: number, mo: number, d: number, hh: number, mm: number, ampm: string | undefined;
  if (iso) {
    [y, mo, d, hh, mm] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5])];
    ampm = iso[6];
  } else if (au) {
    // A bare hour needs am/pm or minutes to count as an exact time.
    if (!au[5] && !au[6]) return null;
    [d, mo, y, hh, mm] = [Number(au[1]), Number(au[2]), Number(au[3]), Number(au[4]), Number(au[5] ?? '0')];
    ampm = au[6];
  } else return null;
  void time;
  const t = to24(hh, mm, ampm);
  if (!t || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  const at = localDateTimeToIso(`${y}-${pad(mo)}-${pad(d)}T${pad(t[0])}:${pad(t[1])}`, timeZone);
  return new Date(at).getTime() > now.getTime() ? at : null;
}

/** Quote unless the answers clearly ask to book; vague answers stay quotes so nobody goes unanswered. */
export function classifyFacebookAnswers(answers: RawAnswer[], timeZone: string, now: Date): Classification {
  const text = answersText(answers);
  const requestedAt = parseExactDateTime(text, timeZone, now);
  const wantsBooking = BOOKING_WORDS.test(text) && !QUOTE_WORDS.test(text);
  return { intent: requestedAt || wantsBooking ? 'booking' : 'quote', requestedAt };
}

export function formatAuPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  const local = digits.startsWith('61') ? `0${digits.slice(2)}` : digits;
  if (/^04\d{8}$/.test(local)) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  if (/^0[2378]\d{8}$/.test(local)) return `(${local.slice(0, 2)}) ${local.slice(2, 6)} ${local.slice(6)}`;
  return phone?.trim() || null;
}

export type ReplyInput = {
  firstName: string;
  businessName: string;
  phone: string | null;
  quoteUrl: string | null;
  intent: FacebookIntent;
  returning: boolean;
  service: string | null;
  /** Human time of a booking actually saved to the calendar, if any. */
  bookedLabel: string | null;
};

/** Builds the single enquiry reply. Returns null when there is no way to offer the customer a next step. */
export function buildFacebookReply(r: ReplyInput): string | null {
  if (!r.phone && !r.quoteUrl) return null;
  const hi = r.returning
    ? `Hi ${r.firstName}, welcome back to ${r.businessName}! Great to hear from you again.`
    : `Hi ${r.firstName}, thanks for contacting ${r.businessName}.`;
  const about = r.service ? ` about ${r.service}` : '';
  let middle: string;
  if (r.intent === 'booking' && r.bookedLabel) {
    middle = `We've pencilled you in for ${r.bookedLabel}${about ? ` for ${r.service}` : ''}. We'll be in touch to confirm.`;
  } else if (r.intent === 'booking') {
    middle = `We got your booking request${about}. To lock in a time`;
  } else {
    middle = `We got your quote request${about}. For your quote`;
  }
  const options = [r.phone ? `call or text ${r.phone}` : null, r.quoteUrl ? `chat with us here: ${r.quoteUrl}` : null].filter(Boolean).join(', or ');
  const next = r.intent === 'booking' && r.bookedLabel
    ? ` Questions? ${options.charAt(0).toUpperCase()}${options.slice(1)}.`
    : `, ${options}.`;
  return `${hi} ${middle}${next} Reply STOP to opt out.`;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Returning customer = same mobile, same name and same email (all three). */
export function isSameCustomer(a: { mobile: string | null; name: string | null; email: string | null }, b: { mobile: string | null; name: string | null; email: string | null }): boolean {
  return !!a.mobile && !!a.email && !!a.name && a.mobile === b.mobile && norm(a.name) === norm(b.name) && norm(a.email) === norm(b.email);
}
