/**
 * Quote-page funnel measurement (pure).
 *
 * Nothing here sends, books or contacts anyone. It turns stored conversation
 * state into: how far each conversation got, where conversations stop, and
 * which partial prospects gave a mobile number without finishing.
 *
 * Bookings are never read from conversation state — the caller passes the
 * authoritative confirmed-booking count from jobs/booking offers.
 */
import type { WebChatCollected } from "@/lib/web-chat";

export const QUOTE_STAGES = [
  "opened",
  "service",
  "details",
  "contact",
  "mobile",
  "review",
  "consent",
  "booked",
] as const;

export type QuoteStage = (typeof QUOTE_STAGES)[number];

export const STAGE_LABELS: Record<QuoteStage, string> = {
  opened: "Opened the page",
  service: "Chose a service",
  details: "Gave vehicle or location",
  contact: "Gave a name",
  mobile: "Gave a mobile number",
  review: "Confirmed the summary",
  consent: "Finished the enquiry",
  booked: "Booked a time",
};

export type ConversationRow = {
  id: string;
  status: string;
  collected: WebChatCollected;
  leadId: string | null;
  consentOutcome: string | null;
  mobileCapturedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  customerMessages: number;
  serviceNameSnapshot?: string | null;
};

/** How far this conversation actually got, from stored answers only. */
export function furthestStage(collected: WebChatCollected): QuoteStage {
  if (collected.booking_confirmed === true) return "booked";
  if (collected.consent === "granted") return "consent";
  if (collected.reviewed === true) return "review";
  if ((collected.mobile_number ?? "").trim()) return "mobile";
  if ((collected.name ?? "").trim()) return "contact";
  if (
    (collected.vehicle_type ?? "").trim() ||
    (collected.suburb ?? "").trim() ||
    (collected.service_address ?? "").trim() ||
    (collected.concerns ?? "").trim()
  ) {
    return "details";
  }
  if (collected.service_id || (collected.typed_request ?? "").trim()) return "service";
  return "opened";
}

/**
 * Obvious test traffic: placeholder mobiles like 0400000000 or 0412345678.
 * Flagged, never deleted, so real numbers are never assumed to be tests.
 */
export function isTestConversation(row: {
  collected: WebChatCollected;
}): boolean {
  const digits = (row.collected.mobile_number ?? "").replace(/\D/g, "");
  if (digits.length < 9) return false;
  const local = digits.replace(/^61/, "").replace(/^0/, "");
  if (/(\d)\1{5,}/.test(local)) return true;
  if (local.startsWith("412345678") || local.startsWith("400000000")) return true;
  if (/^4(0000|1111|2222|9999)/.test(local)) return true;
  return false;
}

export type FunnelStep = { stage: QuoteStage; label: string; count: number };

export type QuoteFunnel = {
  /** Page opens recorded from the quote link, including ad clicks that bounced. */
  opens: number;
  /** Conversations started (a chat record exists). */
  conversations: number;
  /** Conversations where the visitor sent at least one message. */
  interacted: number;
  steps: FunnelStep[];
  /** Conversations that went quiet at each stage, worst first. */
  dropOffs: FunnelStep[];
  abandoned: number;
  stillActive: number;
  finishedIntake: number;
  /** Authoritative bookings, counted from confirmed jobs. */
  booked: number;
  testConversations: number;
  unfinishedWithMobile: number;
};

/** Builds the funnel from conversation rows plus authoritative outside counts. */
export function buildFunnel(input: {
  rows: ConversationRow[];
  opens: number;
  confirmedBookings: number;
}): QuoteFunnel {
  const real = input.rows.filter((row) => !isTestConversation(row));
  const reached = new Map<QuoteStage, number>();
  const stopped = new Map<QuoteStage, number>();
  for (const stage of QUOTE_STAGES) {
    reached.set(stage, 0);
    stopped.set(stage, 0);
  }

  let interacted = 0;
  let abandoned = 0;
  let stillActive = 0;
  let finishedIntake = 0;
  let unfinishedWithMobile = 0;

  for (const row of real) {
    if (row.customerMessages > 0) interacted += 1;
    if (row.status === "abandoned") abandoned += 1;
    if (row.status === "active") stillActive += 1;
    if (row.status === "completed") finishedIntake += 1;

    const stage = furthestStage(row.collected);
    const index = QUOTE_STAGES.indexOf(stage);
    for (let i = 0; i <= index; i += 1) {
      const key = QUOTE_STAGES[i]!;
      reached.set(key, (reached.get(key) ?? 0) + 1);
    }
    if (row.status !== "completed") {
      stopped.set(stage, (stopped.get(stage) ?? 0) + 1);
    }
    if (isUnfinishedProspect(row)) unfinishedWithMobile += 1;
  }

  const steps: FunnelStep[] = QUOTE_STAGES.filter((stage) => stage !== "booked").map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: stage === "opened" ? Math.max(input.opens, real.length) : (reached.get(stage) ?? 0),
  }));
  steps.push({ stage: "booked", label: STAGE_LABELS.booked, count: input.confirmedBookings });

  const dropOffs = QUOTE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: stopped.get(stage) ?? 0,
  }))
    .filter((step) => step.count > 0 && step.stage !== "booked")
    .sort((a, b) => b.count - a.count);

  return {
    opens: input.opens,
    conversations: real.length,
    interacted,
    steps,
    dropOffs,
    abandoned,
    stillActive,
    finishedIntake,
    booked: input.confirmedBookings,
    testConversations: input.rows.length - real.length,
    unfinishedWithMobile,
  };
}

/**
 * A partial prospect: gave a mobile number, never finished, never declined.
 * Declined consent is excluded outright — they asked not to be contacted.
 */
export function isUnfinishedProspect(row: ConversationRow): boolean {
  if (row.leadId) return false;
  if (row.consentOutcome === "declined" || row.collected.consent === "declined") return false;
  if (row.status === "completed" || row.status === "declined") return false;
  if (!(row.collected.mobile_number ?? "").trim()) return false;
  if (isTestConversation(row)) return false;
  return true;
}

export type UnfinishedProspect = {
  conversationId: string;
  name: string | null;
  mobile: string;
  suburb: string | null;
  services: string[];
  stage: QuoteStage;
  stageLabel: string;
  startedAt: string;
  lastActivityAt: string;
  abandoned: boolean;
};

/** View-only list of partial prospects, most recently active first. */
export function unfinishedProspects(rows: ConversationRow[]): UnfinishedProspect[] {
  return rows
    .filter(isUnfinishedProspect)
    .map((row) => {
      const stage = furthestStage(row.collected);
      const services = [
        row.collected.service_name ?? row.serviceNameSnapshot ?? null,
        ...(row.collected.extra_service_names ?? []),
      ].filter((value): value is string => Boolean(value && value.trim()));
      return {
        conversationId: row.id,
        name: (row.collected.name ?? "").trim() || null,
        mobile: (row.collected.mobile_number ?? "").trim(),
        suburb: (row.collected.suburb ?? "").trim() || null,
        services,
        stage,
        stageLabel: STAGE_LABELS[stage],
        startedAt: row.createdAt,
        lastActivityAt: row.lastActivityAt,
        abandoned: row.status === "abandoned",
      };
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Attribution captured from the quote link when the page is opened. */
export type QuoteAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  landingUrl: string | null;
  utm: Record<string, string>;
};

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
] as const;

/** Reads ad attribution out of the landing URL's query string. */
export function readAttribution(input: {
  url: string;
  referrer?: string | null;
}): QuoteAttribution {
  let params = new URLSearchParams();
  let landing = input.url;
  try {
    const parsed = new URL(input.url);
    params = parsed.searchParams;
    landing = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // A malformed URL still records the open, just without attribution.
  }
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }
  const referrer = (input.referrer ?? "").trim() || null;
  const inferredSource = utm["utm_source"]
    ?? (utm["fbclid"] ? "facebook" : utm["gclid"] ? "google" : null)
    ?? (referrer ? hostOf(referrer) : null);
  return {
    source: inferredSource ?? "direct",
    medium: utm["utm_medium"] ?? (utm["fbclid"] || utm["gclid"] ? "paid" : null),
    campaign: utm["utm_campaign"] ?? null,
    referrer,
    landingUrl: landing.slice(0, 300),
    utm,
  };
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Groups recorded opens by the campaign/source they came from. */
export function opensBySource(
  events: { source: string | null; campaign: string | null }[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = [event.source ?? "direct", event.campaign].filter(Boolean).join(" — ");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
