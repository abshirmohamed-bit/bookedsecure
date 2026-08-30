// Client-safe domain constants and helpers shared by UI and server code.

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "waiting_for_customer",
  "customer_replied",
  "ready_for_quote",
  "quote_sent",
  "scheduled",
  "completed",
  "lost",
  "opted_out",
  "invalid",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  waiting_for_customer: "Waiting for customer",
  customer_replied: "Replied",
  ready_for_quote: "Quote ready",
  quote_sent: "Quote sent",
  scheduled: "Booked",
  completed: "Completed",
  lost: "Lost",
  opted_out: "Opted out",
  invalid: "Invalid",
};

export const SOURCE_CHANNELS = ["meta", "website", "hosted_page", "manual", "unknown"] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

/**
 * Values permitted by the `leads_lead_origin_check` database constraint.
 * NULL is also accepted (that is what the live `captureLead` path writes).
 */
export const LEAD_ORIGINS = ["live", "historical", "reactivation", "crm_import"] as const;
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

export function isAllowedLeadOrigin(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return (LEAD_ORIGINS as readonly string[]).includes(value);
}


export const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta",
  website: "Website",
  hosted_page: "Hosted quote page",
  manual: "Manual",
  unknown: "Unknown",
};

export const READINESS_LABELS: Record<string, string> = {
  new: "New",
  needs_information: "Needs information",
  quote_ready: "Quote ready",
  high_intent: "High intent",
  unclear: "Unclear",
  not_suitable: "Not suitable",
};

export const DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "unknown",
] as const;

// Statuses where automated SMS must never be sent.
export const AUTOMATION_BLOCKED_STATUSES: LeadStatus[] = [
  "opted_out",
  "invalid",
  "completed",
  "lost",
];

export const VEHICLE_TYPES = [
  "Small car / hatch",
  "Sedan",
  "Medium SUV",
  "Large SUV / 4WD",
  "Ute",
  "Van",
  "Other",
];

export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "cancel", "quit", "end", "optout", "opt out"];

export function isOptOutMessage(body: string): boolean {
  const normalised = body.trim().toLowerCase().replace(/[^a-z ]/g, "");
  return OPT_OUT_KEYWORDS.includes(normalised);
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => vars[key] ?? "");
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function normaliseAuMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+61[2-478]\d{8}$/.test(digits)) return digits;
  if (/^0[2-478]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^61[2-478]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Automation guard rails (pure, provider-independent, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Lead states that permanently stop automated outbound work.
 * "customer_replied" is included: a reply always ends the follow-up sequence.
 */
export const AUTOMATION_STOP_STATUSES: LeadStatus[] = [
  "opted_out",
  "completed",
  "lost",
  "invalid",
  "customer_replied",
];

export function stopsAutomation(status: string, optedOutAt?: string | null): boolean {
  if (optedOutAt) return true;
  return (AUTOMATION_STOP_STATUSES as string[]).includes(status);
}

/** True when `hour` falls inside the [start, end) quiet window (wraps midnight). */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Local hour (0-23) for a business timezone. */
export function businessLocalHour(timezone: string, at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
}
