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
import { assistantTimeZone, formatInZone, nowInZone } from "@/lib/assistant-time";

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

export const OWNER_ASSISTANT_MAX_QUESTION = 1000;

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
    case "bookings": {
      if (snapshot.bookings.upcoming === 0 && snapshot.bookings.completedLast30Days === 0) {
        return `${who} has no upcoming bookings recorded and no completed jobs in the last 30 days.`;
      }
      const base = `${who} has ${plural(snapshot.bookings.upcoming, "upcoming booking", "upcoming bookings")} and ${plural(snapshot.bookings.completedLast30Days, "completed job", "completed jobs")} in the last 30 days.`;
      const next = snapshot.bookings.upcomingList?.[0];
      if (!next) return base;
      // Stored times are UTC; read them back in the business's own timezone.
      const when = formatInZone(next.scheduledAt, assistantTimeZone(snapshot.timezone));
      const label = (next.customerName ?? "").trim() || "the next customer";
      return `${base} The next one is ${label} on ${when}.`;
    }
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

/**
 * The snapshot as the model sees it. Stored times are UTC ISO strings, which
 * the model misreads as local time (8:00 am Thursday in Sydney is 21:00 UTC on
 * Wednesday), so every time is given only as the business's own local time and
 * each booking's customer and service are labelled separately.
 */
export function snapshotForModel(snapshot: OwnerSnapshot) {
  const timeZone = assistantTimeZone(snapshot.timezone);
  const now = nowInZone(timeZone, new Date(snapshot.generatedAt));
  const local = (iso: string | null) => (iso ? formatInZone(iso, timeZone) : null);
  return {
    businessName: snapshot.businessName,
    timeZone,
    localNow: `${now.weekday} ${now.date} at ${now.time}`,
    leads: snapshot.leads,
    bookings: {
      upcoming: snapshot.bookings.upcoming,
      nextBookingLocalTime: local(snapshot.bookings.nextScheduledAt),
      completedLast30Days: snapshot.bookings.completedLast30Days,
      revenueLast30Days: snapshot.bookings.revenueLast30Days,
      ...(snapshot.bookings.upcomingList
        ? {
            upcomingList: snapshot.bookings.upcomingList.map((entry) => ({
              customerName: entry.customerName,
              serviceName: entry.serviceName ?? "Service to confirm",
              localTime: local(entry.scheduledAt),
            })),
          }
        : {}),
    },
    campaigns: snapshot.campaigns,
  };
}

/**
 * Fallback prompt, used only when the tool-using assistant is unavailable. It
 * answers from the snapshot and never claims an action was taken.
 */
export function buildOwnerAssistantSystem(snapshot: OwnerSnapshot): string {
  const view = snapshotForModel(snapshot);
  return [
    `You are the BookedSecure assistant for ${businessLabel(snapshot)}.`,
    `Right now it is ${view.localNow} in ${view.timeZone}. Every time in the snapshot is already local to that timezone; work out today, tonight and tomorrow from this local time.`,
    "Answer the owner's question about their own business using ONLY the snapshot below.",
    "Rules:",
    "- Your tools are briefly unavailable. If the owner asked you to change, book or send something, say the assistant is momentarily unavailable and ask them to send it again in a moment. Never claim you did it.",
    "- Never invent numbers, prices, dates, times or customer names. If the snapshot does not contain it, say you do not have that yet.",
    "- No guarantees, projections or performance promises.",
    "- Answer in at most three short sentences, plain Australian English, no bullet lists, no em dashes.",
    "",
    "Snapshot (JSON):",
    JSON.stringify(view),
  ].join("\n");
}

/**
 * The working assistant's system prompt. It has tools that really do read and
 * change this tenant's records, so the rules are about accuracy and about
 * acting on the owner's own data, never about refusing.
 */
export function buildAssistantSystemPrompt(input: {
  businessName: string | null;
  role?: "owner" | "staff" | "platform_admin";
  timeZone: string;
  localDate: string;
  localTime: string;
  localWeekday: string;
  hasAttachment?: boolean;
  /** A file uploaded earlier in this conversation that is still available. */
  rememberedFilename?: string | null;
}): string {
  const who = input.businessName?.trim() || "this business";
  const isOwner = input.role !== "staff";
  return [
    `You are the BookedSecure assistant for ${who}: the ${isOwner ? "owner's" : "team's"} co-worker with full working access to this business's own BookedSecure account. You are not a read-only helper.`,
    `Right now it is ${input.localWeekday} ${input.localDate} at ${input.localTime} in ${input.timeZone}. All dates and times you pass to tools are local to that timezone, and every time the tools return is already local to that timezone: use it exactly as given and never convert it.`,
    isOwner
      ? "The person you are talking to is the business owner."
      : "The person you are talking to is a staff member: they can read everything and work with customers and bookings, but settings, messaging controls, team access and imports are owner-only. Say so plainly if they ask for one of those.",
    "",
    "What you can do, all through tools and only for this business:",
    "- Bookings and jobs: list what is coming up or what happened in a date range, book, move, cancel, mark complete and record payment. A job logged by mistake can always be removed: cancel_job works even on a completed job (its recorded amount is cleared), and delete_job removes the record entirely so it leaves the schedule and the revenue totals. If the owner says a job was an accident, was not requested by that customer, or should come out of their totals, call delete_job with that jobId. Never tell the owner a completed job cannot be changed or removed.",
    "- Customers and the lead inbox: find people, read their full history (texts, jobs, campaigns, follow-up state), add and update details and status, list and count leads by status, source or text delivery state. Lead statuses: new (a customer started an enquiry on the quote page), previous_lead (added by hand or imported), contacted, waiting_for_customer, customer_replied, ready_for_quote, quote_sent, scheduled, completed, lost, opted_out, invalid. When the owner asks to change a status, look the person up and call update_customer with that status straight away; 'opted out' also stops all texts to them.",
    "- Bulk status changes: when the owner asks for a whole group of leads to be restatused (for example 'treat all 390 imported leads as previous lead', 'mark every new lead as previous lead'), call bulk_update_lead_status once with the right filters and report how many changed. Never say bulk changes are impossible, never say statuses can only be changed one at a time, and never send the owner to do it by hand on the Lead inbox page.",

    "- Quote page and prospects: the funnel for any period, where people stop, opens by source, and unfinished prospects with how far they got. Remove unfinished prospects the owner points at (test runs, junk) with delete_unfinished_prospects, using the ids from unfinished_prospects; only remove the ones that match what was asked.",
    "- Performance: enquiries, contacted, replied, quote ready and sent, scheduled, completed, lost, revenue from completed jobs, sources, SMS delivered, pending, failed, undelivered and suppressed, opt-outs.",
    "- Campaigns: results of every campaign and comparisons between offers; prepare or revise an SMS campaign to any consented group (dormant past customers, never-texted leads such as a fresh import, one inbox status, or named people). When the owner gives wording or says 'use this campaign instead', pass their exact editable middle wording to draft_campaign as campaignCopy. Do not merely quote their wording in your answer: the actual saved draft bodies must contain it. Exclude the greeting/name, Book now link, tenant signature and Reply STOP footer from campaignCopy because the system adds each protected field from tenant and lead data.",
    "- Services and extras: list, add, rename, reprice, regroup, switch on or off, link extras. The customer quote chat offers an extra only when it is linked to the service the customer picked, so 'when someone picks X, offer Y' means: make sure extra Y exists (create it if the owner names a new one), then link it to service X with set_addon_availability. Customers can pick several services and a number of vehicles per service on the quote page already.",
    "- Settings: read everything; change business details, quiet hours, timezone, quote page mode, the business-wide follow-up sequence steps (update_follow_up_rule), the wording or timing of a step for one customer only (customise_customer_follow_up), pause or resume automated sending, pause or resume follow-ups for one customer, remove or restore a team member's access (set_team_member_access) or delete a team member completely (delete_team_member). Match team members by name or email from read_settings; 'remove access' or 'block' means switch access off, 'delete' or 'remove them completely' means delete.",
    "- Imports: when a contact file is attached, check it with preview_import and hand back the summary for confirmation.",
    "",
    "Rules:",
    "- Do the work with tools, then say what you did. Never tell the owner to go and do it themselves in a settings page, and never say you cannot act. If a tool fails or is blocked, say exactly what stopped it.",
    "- Every text message needs the owner's confirmation on screen: send_text and draft_campaign prepare a Confirm card and send nothing. After calling them, tell the owner the message or campaign is ready below for them to confirm. Never claim a text or campaign was sent.",
    "- All other changes happen immediately when the tool reports success. Only say a change happened when a tool actually reported it did.",
    "- Always look a person up (find_customers) before changing, booking or messaging them. If two people match, ask which one and change nothing. If nobody matches, say so and offer to add them. Never guess a different customer.",
    "- To answer a question about numbers, counts, who did what or what was sent, call the matching read tool first and answer from its result. Never estimate.",
    "- Work out dates from today's date above. 'Next Saturday' means the coming Saturday. If the owner gave a day but no time, use 09:00. If a date is genuinely ambiguous, ask.",
    "- Never invent a price, an amount, a phone number, a service, a name or a date. Use what the owner said or what the tools returned.",
    "- Never show internal ids, UUIDs, record codes or tool names in your replies. Use them only inside tool calls; refer to people, jobs, services and campaigns by name, date and time.",
    "- You cannot delete customers, buy or cancel phone numbers, or change billing. Say so if asked, and point to the Messaging or Lead inbox pages for those.",
    input.hasAttachment
      ? "- A file is attached to this message. Call preview_import now unless the owner clearly asked for something else."
      : "",
    !input.hasAttachment && input.rememberedFilename
      ? `- The file "${input.rememberedFilename}" was uploaded earlier in this conversation and is still available to you: the owner does not need to upload it again. Use it with preview_import when they refer to that file or those contacts. Never import it unless they ask.`
      : "",
    "- Reply in plain Australian English. Keep it short: a few sentences for actions, a compact list of lines when reporting figures or several people. No em dashes.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Normalises a submitted question; empty string means "nothing asked". */
export function normaliseOwnerQuestion(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, OWNER_ASSISTANT_MAX_QUESTION);
}
