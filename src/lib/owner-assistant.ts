/**
 * Owner-facing assistant: pure logic only.
 *
 * The assistant is READ-ONLY. It answers questions about a tenant's own
 * business from a snapshot of that tenant's stored records. It never sends a
 * message, creates or changes a booking, approves a campaign, or edits a lead.
 *
 * Everything here is tenant-neutral: the snapshot carries the business name and
 * numbers, and no business is special-cased.
 */

export type OwnerSnapshot = {
  businessName: string | null;
  generatedAt: string;
  timezone: string | null;
  leads: {
    total: number;
    new: number;
    last7Days: number;
    awaitingReply: number;
  };
  bookings: {
    upcoming: number;
    nextScheduledAt: string | null;
    completedLast30Days: number;
    revenueLast30Days: number;
    /** Next few scheduled jobs, so the assistant can name real times only. */
    upcomingList?: readonly {
      customerName: string | null;
      serviceName: string | null;
      scheduledAt: string;
    }[];
  };
  campaigns: {
    total: number;
    openStatus: string | null;
    openOffer: string | null;
    drafted: number;
    sent: number;
    replied: number;
  };
};

export type OwnerQuestionIntent = "bookings" | "leads" | "campaigns" | "replies" | "overview";

export const OWNER_ASSISTANT_MAX_QUESTION = 500;

/** Shapes the question into one of the snapshot areas. Never throws. */
export function classifyOwnerQuestion(question: string): OwnerQuestionIntent {
  const text = (question ?? "").toLowerCase();
  if (/\b(book|booking|bookings|booked|job|jobs|appointment|schedule|scheduled|revenue|money|earn)/.test(text)) {
    return "bookings";
  }
  if (/\b(campaign|campaigns|reactivat|win.?back|offer|discount|dormant|old leads?)/.test(text)) {
    return "campaigns";
  }
  if (/\b(reply|replies|replied|respond|response|waiting|unanswered|follow.?up)/.test(text)) {
    return "replies";
  }
  if (/\b(lead|leads|enquir|inquir|customer|contact)/.test(text)) return "leads";
  return "overview";
}

function businessLabel(snapshot: OwnerSnapshot): string {
  const name = (snapshot.businessName ?? "").trim();
  return name.length > 0 ? name : "your business";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Deterministic answer built only from the snapshot. Used as the fallback
 * whenever the model is unavailable, and as the factual floor the model's
 * phrasing is checked against.
 */
export function renderSnapshotAnswer(snapshot: OwnerSnapshot, intent: OwnerQuestionIntent): string {
  const who = businessLabel(snapshot);
  switch (intent) {
    case "bookings":
      return snapshot.bookings.upcoming === 0 && snapshot.bookings.completedLast30Days === 0
        ? `${who} has no upcoming bookings recorded and no completed jobs in the last 30 days.`
        : `${who} has ${plural(snapshot.bookings.upcoming, "upcoming booking", "upcoming bookings")} and ${plural(snapshot.bookings.completedLast30Days, "completed job", "completed jobs")} in the last 30 days.`;
    case "campaigns":
      return snapshot.campaigns.total === 0
        ? `No reactivation campaigns have been created for ${who} yet.`
        : `${plural(snapshot.campaigns.total, "reactivation campaign", "reactivation campaigns")} so far. The latest has ${plural(snapshot.campaigns.drafted, "drafted message", "drafted messages")}, ${snapshot.campaigns.sent} sent and ${snapshot.campaigns.replied} replied.`;
    case "replies":
      return snapshot.leads.awaitingReply === 0
        ? `Nothing is waiting on a reply right now.`
        : `${plural(snapshot.leads.awaitingReply, "lead", "leads")} replied last and are waiting on you.`;
    case "leads":
      return `${plural(snapshot.leads.total, "active lead", "active leads")}, ${snapshot.leads.new} still marked new, ${snapshot.leads.last7Days} added in the last 7 days.`;
    case "overview":
    default:
      return `${who}: ${plural(snapshot.leads.total, "active lead", "active leads")} (${snapshot.leads.new} new), ${plural(snapshot.bookings.upcoming, "upcoming booking", "upcoming bookings")}, ${snapshot.leads.awaitingReply} waiting on a reply.`;
  }
}

/**
 * Claims the assistant must never make. Owner-facing text may quote stored
 * numbers, but it must not promise a customer outcome, invent a price or a
 * time, or claim it has acted.
 */
const BANNED_ANSWER_PATTERNS: readonly RegExp[] = [
  /\bI(?:'ve| have)? (?:just )?(?:sent|texted|messaged|booked|scheduled|approved|cancelled|deleted|updated)\b/i,
  /\bI will (?:send|text|message|book|schedule|approve|cancel|delete)\b/i,
  /\bguarantee|\bguaranteed\b/i,
  /\bwill definitely\b/i,
  /\b\d+\s?%\s?(?:more|increase|conversion|better)\b/i,
];

/** True when the sentence makes a claim the assistant is not allowed to make. */
export function isBannedAnswerSentence(sentence: string): boolean {
  return BANNED_ANSWER_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Strips guard-rail violations from the model's phrasing rather than trusting
 * it. If nothing survives, the caller falls back to the deterministic answer.
 */
export function guardAssistantAnswer(answer: string): string {
  const sentences = (answer ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.filter((sentence) => !isBannedAnswerSentence(sentence)).join(" ").trim();
}

/** The system prompt. Read-only, snapshot-only, short answers. */
export function buildOwnerAssistantSystem(snapshot: OwnerSnapshot): string {
  return [
    `You are the BookedSecure assistant for ${businessLabel(snapshot)}.`,
    "Answer the owner's question about their own business using ONLY the snapshot below.",
    "Rules:",
    "- You are read-only. You cannot send messages, book jobs, approve campaigns or change records. Never claim you did or will.",
    "- Never invent numbers, prices, dates, times or customer names. If the snapshot does not contain it, say you do not have that yet.",
    "- No guarantees, projections or performance promises.",
    "- Answer in at most three short sentences, plain Australian English, no bullet lists, no em dashes.",
    "",
    "Snapshot (JSON):",
    JSON.stringify(snapshot),
  ].join("\n");
}

/** Normalises a submitted question; empty string means "nothing asked". */
export function normaliseOwnerQuestion(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, OWNER_ASSISTANT_MAX_QUESTION);
}
