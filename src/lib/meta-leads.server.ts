import { createHmac, timingSafeEqual } from "node:crypto";

type MetaField = { name?: unknown; values?: unknown };
type MetaLead = {
  id?: unknown;
  form_id?: unknown;
  created_time?: unknown;
  field_data?: unknown;
};

export type MetaLeadEvent = { pageId: string; formId: string; leadId: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function verifyMetaSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signature.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifyMetaChallenge(url: URL, verifyToken: string): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !verifyToken || !token || !challenge) return null;
  const expected = Buffer.from(verifyToken);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received)
    ? challenge
    : null;
}

/** Meta sends a lead id, not the answers. Only events for the configured Page are accepted. */
export function extractMetaLeadEvents(payload: unknown, pageId: string): MetaLeadEvent[] {
  if (!payload || typeof payload !== "object" || (payload as { object?: unknown }).object !== "page") {
    return [];
  }
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const result: MetaLeadEvent[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || String(entry.id) !== pageId) continue;
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== "leadgen" || !change.value || typeof change.value !== "object") continue;
      const value = change.value as Record<string, unknown>;
      const leadId = text(value.leadgen_id);
      const formId = text(value.form_id);
      if (String(value.page_id) !== pageId || !leadId || !formId || !/^\d+$/.test(leadId)) continue;
      result.push({ pageId, formId, leadId });
    }
  }
  return result;
}

export function mapMetaLead(lead: MetaLead, event: MetaLeadEvent) {
  if (String(lead.id) !== event.leadId || String(lead.form_id) !== event.formId) {
    throw new Error("Meta lead does not match webhook event");
  }
  const answers: Record<string, string> = {};
  for (const field of Array.isArray(lead.field_data) ? (lead.field_data as MetaField[]) : []) {
    const key = text(field?.name)?.toLowerCase();
    const value = Array.isArray(field?.values) ? text(field.values[0]) : null;
    if (key && value) answers[key.slice(0, 120)] = value.slice(0, 500);
  }
  const name = answers.full_name ||
    [answers.first_name, answers.last_name].filter(Boolean).join(" ") ||
    `Meta lead ${event.leadId}`;

  return {
    name: name.slice(0, 80),
    mobile_number: answers.phone_number || answers.phone || "",
    email: answers.email || null,
    source_channel: "meta",
    source_form: event.formId,
    lead_origin: "inbound_form",
    external_id: `meta:${event.leadId}`,
    // A Meta submission by itself is not evidence of SMS consent. The lead
    // reaches the inbox; the acknowledgement path remains gated off.
    consent: false,
    source_metadata: {
      meta: { page_id: event.pageId, form_id: event.formId, leadgen_id: event.leadId,
        submitted_at: text(lead.created_time), answers },
    },
  } as const;
}

export async function fetchMetaLead(event: MetaLeadEvent, token: string, version: string): Promise<MetaLead> {
  if (!token || !/^v\d+\.\d+$/.test(version)) throw new Error("Meta API configuration is incomplete");
  const url = new URL(`https://graph.facebook.com/${version}/${event.leadId}`);
  url.searchParams.set("fields", "id,form_id,created_time,field_data");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Meta lead fetch failed (${response.status})`);
  return await response.json() as MetaLead;
}
