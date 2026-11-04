import { createHmac, timingSafeEqual } from "node:crypto";

type MetaChange = {
  field?: string;
  value?: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string };
};
type MetaWebhook = { object?: string; entry?: { id?: string; changes?: MetaChange[] }[] };
type MetaLead = {
  id: string;
  field_data?: { name: string; values?: string[] }[];
  form_id?: string;
  ad_id?: string;
};

export function verifyMetaSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const supplied = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

export function metaLeadEvents(payload: MetaWebhook, pageId: string, formId: string) {
  if (payload.object !== "page") return [];
  return (payload.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) =>
        change.field === "leadgen" &&
        entry.id === pageId &&
        change.value?.page_id === pageId &&
        change.value?.form_id === formId &&
        /^\d+$/.test(change.value?.leadgen_id ?? ""),
      )
      .map((change) => ({ leadId: change.value!.leadgen_id!, formId, adId: change.value?.ad_id ?? null })),
  );
}

export function mapMetaLead(lead: MetaLead, consentField: string | undefined, consentValue: string | undefined) {
  const fields = new Map((lead.field_data ?? []).map((field) => [field.name.toLowerCase(), field.values?.[0]?.trim() ?? ""]));
  const get = (...names: string[]) => names.map((name) => fields.get(name)).find(Boolean) ?? null;
  const name = get("full_name") ?? ([get("first_name"), get("last_name")].filter(Boolean).join(" ") || `Meta lead ${lead.id}`);
  // Only a deliberately configured, exact consent answer enables the SMS path.
  const consent = Boolean(consentField && consentValue && fields.get(consentField.toLowerCase()) === consentValue);
  return {
    name,
    mobile_number: get("phone_number", "phone") ?? "",
    email: get("email"),
    suburb: get("suburb", "city"),
    vehicle_type: get("vehicle_type"),
    service_intent: get("service", "service_intent"),
    main_concerns: get("main_concerns"),
    consent,
  };
}

export async function fetchMetaLead(leadId: string, token: string, version: string): Promise<MetaLead> {
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Meta Graph API version");
  const url = new URL(`https://graph.facebook.com/${version}/${leadId}`);
  url.searchParams.set("fields", "id,field_data,form_id,ad_id");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Meta lead retrieval failed (${response.status})`);
  return response.json() as Promise<MetaLead>;
}
