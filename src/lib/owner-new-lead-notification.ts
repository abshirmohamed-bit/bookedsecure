// Fixed-field operational SMS to the tenant owner when a new enquiry arrives.
// Pure policy and rendering only; no database or carrier access.
import { normaliseOwnerNotificationNumber } from "@/lib/owner-phone";

export const OWNER_NEW_LEAD_TEMPLATE_ID = "owner_new_lead.v1" as const;

export type OwnerNewLeadBlock =
  | "eligible"
  | "blocked_muted"
  | "blocked_no_owner_number"
  | "blocked_invalid_owner_number";

export function evaluateOwnerNewLeadEligibility(input: {
  ownerNotificationNumber: string | null | undefined;
  mutedKinds: string[] | null | undefined;
}): { sendable: boolean; outcome: OwnerNewLeadBlock; reason: string } {
  if ((input.mutedKinds ?? []).includes("new_lead")) {
    return { sendable: false, outcome: "blocked_muted", reason: "New enquiry alerts are muted for this business." };
  }
  const raw = (input.ownerNotificationNumber ?? "").trim();
  if (!raw) {
    return { sendable: false, outcome: "blocked_no_owner_number", reason: "This business has no owner alert mobile saved." };
  }
  if (!normaliseOwnerNotificationNumber(raw)) {
    return { sendable: false, outcome: "blocked_invalid_owner_number", reason: "The saved owner alert mobile is invalid." };
  }
  return { sendable: true, outcome: "eligible", reason: "Eligible to send." };
}

/** One owner SMS per distinct durable owner-alert job. */
export function ownerNewLeadSmsIdempotencyKey(alertKey: string): string {
  return `tenant_owner_new_lead:${alertKey}`;
}

function field(value: string | null | undefined, fallback: string, max = 60): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, max);
}

export function renderOwnerNewLeadAlert(input: {
  tenantName: string;
  customerName: string | null | undefined;
  customerMobile: string | null | undefined;
  serviceName: string | null | undefined;
  suburb: string | null | undefined;
}): { body: string; templateId: typeof OWNER_NEW_LEAD_TEMPLATE_ID } {
  const tenant = field(input.tenantName, "BookedSecure", 50);
  const name = field(input.customerName, "New customer");
  const mobile = field(input.customerMobile, "", 24);
  const service = field(input.serviceName, "", 50);
  const suburb = field(input.suburb, "", 40);
  const details = [service, suburb].filter(Boolean).join(" · ");
  return {
    templateId: OWNER_NEW_LEAD_TEMPLATE_ID,
    body: `${tenant} new lead: ${name}${mobile ? ` · ${mobile}` : ""}${details ? ` — ${details}` : ""}. Open your BookedSecure inbox.`,
  };
}
