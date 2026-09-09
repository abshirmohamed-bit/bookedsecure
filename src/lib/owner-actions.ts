/**
 * Owner request parsing: pure, deterministic, tenant-neutral.
 *
 * Turns one plain-English owner request typed on the home page into zero, one or
 * two proposed actions. Parsing NEVER performs an action: every proposal is
 * confirmed by the owner before anything is written or sent.
 */

import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/domain";

export type CampaignRequest = {
  kind: "draft_campaign";
  /** Discount percentage the owner asked for, if they named one. */
  percent: number | null;
  /** Cap on how many contacts to include, if they named one. */
  maxLeads: number | null;
  /** Only contacts added at least this many days ago, if they named a window. */
  olderThanDays: number | null;
};

export type StatusRequest = {
  kind: "update_status";
  /** Only leads currently in this status, when the owner named one. */
  from: LeadStatus | null;
  to: LeadStatus;
  maxLeads: number | null;
};

export type OwnerActionRequest = CampaignRequest | StatusRequest;

const CAMPAIGN_TOPIC =
  /\b(campaign|win.?back|winback|reactivat|re-?engage|discount|promo|promotion|offer)\b/i;
const CAMPAIGN_VERB = /\b(draft|create|make|set ?up|build|prepare|send|run|start|write)\b/i;
const STATUS_VERB = /\b(update|mark|set|change|move|reset)\b/i;

/** Words an owner uses for each stored status. */
const STATUS_WORDS: Array<{ status: LeadStatus; pattern: RegExp }> = [
  { status: "contacted", pattern: /\bcontacted\b|\breached out\b/i },
  { status: "waiting_for_customer", pattern: /\bwaiting (?:for|on) (?:the )?customer\b/i },
  { status: "customer_replied", pattern: /\breplied\b/i },
  { status: "ready_for_quote", pattern: /\bquote ready\b|\bready for (?:a )?quote\b/i },
  { status: "quote_sent", pattern: /\bquote sent\b/i },
  { status: "scheduled", pattern: /\bbooked\b|\bscheduled\b/i },
  { status: "completed", pattern: /\bcompleted\b|\bfinished\b/i },
  { status: "lost", pattern: /\blost\b/i },
  { status: "invalid", pattern: /\binvalid\b/i },
  { status: "new", pattern: /\bnew\b/i },
];

/** Statuses this assistant may never set: they are evidence, not admin state. */
export const PROTECTED_TARGETS: readonly string[] = ["opted_out", "completed", "scheduled"];

/**
 * Statuses that are evidence of real work, so a bulk change with no explicit
 * starting status must never overwrite them.
 */
export const PROTECTED_SOURCE_STATUSES: readonly LeadStatus[] = [
  "completed",
  "scheduled",
  "opted_out",
] as unknown as readonly LeadStatus[];

export function isSafeStatusTarget(status: string): boolean {
  return (
    (LEAD_STATUSES as readonly string[]).includes(status) && !PROTECTED_TARGETS.includes(status)
  );
}

export function statusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status as LeadStatus] ?? status;
}

function parsePercent(text: string): number | null {
  const match = /(\d{1,2})\s*(?:%|per ?cent|percent)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 90 ? value : null;
}

function parseCount(text: string): number | null {
  const match =
    /\b(?:top|first|next|about|around|only)?\s*(\d{1,4})\s+(?:of\s+(?:my|the)\s+)?(?:old\s+|dormant\s+|past\s+|previous\s+)?(?:leads?|customers?|contacts?|clients?|people)\b/i.exec(
      text,
    );
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 2000 ? value : null;
}

function parseOlderThanDays(text: string): number | null {
  const numeric = /\b(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i.exec(text);
  if (numeric) {
    const value = Number(numeric[1]);
    const unit = (numeric[2] ?? "").toLowerCase();
    const days = unit.startsWith("week") ? value * 7 : unit.startsWith("month") ? value * 30 : value;
    return days >= 1 && days <= 3650 ? days : null;
  }
  if (/\b(?:a|one)\s+week\b/i.test(text)) return 7;
  if (/\b(?:a|one)\s+month\b/i.test(text)) return 30;
  if (/\btwo\s+weeks\b|\bcouple of weeks\b/i.test(text)) return 14;
  if (/\bwhile\b|\bages\b|\blong time\b/i.test(text)) return 14;
  return null;
}

function findStatuses(text: string): LeadStatus[] {
  // Ordered the way the owner said them, so the last one is the target.
  const found: Array<{ status: LeadStatus; at: number }> = [];
  for (const entry of STATUS_WORDS) {
    const match = entry.pattern.exec(text);
    if (match && !found.some((item) => item.status === entry.status)) {
      found.push({ status: entry.status, at: match.index });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((item) => item.status);
}

/**
 * Parses one owner request. Returns every action it recognises, in the order it
 * should be proposed. An empty array means "just answer the question".
 */
export function parseOwnerRequest(question: string): OwnerActionRequest[] {
  const text = (question ?? "").trim();
  if (text.length === 0) return [];
  const requests: OwnerActionRequest[] = [];

  if (CAMPAIGN_TOPIC.test(text) && CAMPAIGN_VERB.test(text)) {
    requests.push({
      kind: "draft_campaign",
      percent: parsePercent(text),
      maxLeads: parseCount(text),
      olderThanDays: parseOlderThanDays(text),
    });
  }

  if (STATUS_VERB.test(text)) {
    const statuses = findStatuses(text);
    // "mark the new ones as contacted" — the last named status is the target.
    const target = [...statuses].reverse().find((status) => isSafeStatusTarget(status)) ?? null;
    if (target && statuses.length > 0) {
      const from = statuses.find((status) => status !== target) ?? null;
      if (from !== null || statuses.length === 1) {
        requests.push({
          kind: "update_status",
          from: from ?? null,
          to: target,
          maxLeads: parseCount(text),
        });
      }
    }
  }

  return requests;
}

/** One line describing what a proposal will do, for the owner to confirm. */
export function describeStatusChange(input: {
  from: LeadStatus | null;
  to: LeadStatus;
  count: number;
}): string {
  const scope = input.from
    ? `${input.count} lead${input.count === 1 ? "" : "s"} marked ${statusLabel(input.from)}`
    : `${input.count} lead${input.count === 1 ? "" : "s"}`;
  return `Change ${scope} to ${statusLabel(input.to)}.`;
}
