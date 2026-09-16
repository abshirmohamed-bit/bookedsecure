/**
 * Business identity record: I/O layer.
 *
 * Reads and writes are always scoped to the caller's own business, resolved
 * server-side. A business id is never accepted from the browser. Writes are
 * owner-only and audited; the record itself is never exposed publicly.
 */
import type { AppContext } from "@/lib/app-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type BusinessIdentity,
  emptyIdentity,
  missingIdentityFields,
  normaliseAbn,
} from "@/lib/tenant-identity";

type Row = {
  business_id: string;
  legal_name: string;
  trading_name: string | null;
  abn: string;
  address_line1: string;
  address_line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  website: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  message_types: string[];
  declaration_accepted_at: string | null;
  status: string;
  verified_at: string | null;
  updated_at: string | null;
};

function toIdentity(row: Row): BusinessIdentity {
  return {
    legalName: row.legal_name,
    tradingName: row.trading_name,
    abn: row.abn,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    suburb: row.suburb,
    state: row.state,
    postcode: row.postcode,
    country: row.country || "AU",
    website: row.website,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    messageTypes: row.message_types ?? [],
    declarationAcceptedAt: row.declaration_accepted_at,
    status: row.status === "verified" ? "verified" : "pending",
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

export type IdentityInput = {
  legal_name: string;
  trading_name: string | null;
  abn: string;
  address_line1: string;
  address_line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  website: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  message_types: string[];
  declaration_accepted: boolean;
};

/**
 * The record as stored, or a draft seeded from what the business already told
 * us (name, ABN, website, owner contact) so the form opens mostly filled in.
 */
export async function readBusinessIdentity(app: AppContext): Promise<{
  identity: BusinessIdentity;
  exists: boolean;
  missing: string[];
  role: AppContext["role"];
}> {
  const { data } = await supabaseAdmin
    .from("business_identity")
    .select("*")
    .eq("business_id", app.businessId)
    .maybeSingle();

  if (data) {
    const identity = toIdentity(data as Row);
    return { identity, exists: true, missing: missingIdentityFields(identity), role: app.role };
  }

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name, abn, website_url, phone_number")
    .eq("id", app.businessId)
    .maybeSingle();

  const draft: BusinessIdentity = {
    ...emptyIdentity(),
    legalName: business?.name ?? "",
    abn: business?.abn ?? "",
    website: business?.website_url ?? null,
    contactName: app.name ?? "",
    contactEmail: app.email ?? "",
    contactPhone: business?.phone_number ?? "",
  };

  return { identity: draft, exists: false, missing: missingIdentityFields(draft), role: app.role };
}

export async function saveBusinessIdentity(
  app: AppContext,
  input: IdentityInput,
): Promise<{ ok: true; identity: BusinessIdentity; missing: string[] }> {
  if (app.role !== "owner") {
    throw new Error("Only the business owner can save the business identity.");
  }

  const abn = normaliseAbn(input.abn);
  const { data: existing } = await supabaseAdmin
    .from("business_identity")
    .select("declaration_accepted_at")
    .eq("business_id", app.businessId)
    .maybeSingle();

  const acceptedAt = input.declaration_accepted
    ? (existing?.declaration_accepted_at ?? new Date().toISOString())
    : null;

  const payload = {
    business_id: app.businessId,
    legal_name: input.legal_name.trim(),
    trading_name: input.trading_name?.trim() || null,
    abn,
    address_line1: input.address_line1.trim(),
    address_line2: input.address_line2?.trim() || null,
    suburb: input.suburb.trim(),
    state: input.state.trim().toUpperCase(),
    postcode: input.postcode.trim(),
    country: "AU",
    website: input.website?.trim() || null,
    contact_name: input.contact_name.trim(),
    contact_email: input.contact_email.trim(),
    contact_phone: input.contact_phone.trim(),
    message_types: input.message_types,
    declaration_accepted_at: acceptedAt,
    declaration_accepted_by: input.declaration_accepted ? app.userId : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("business_identity")
    .upsert(payload, { onConflict: "business_id" })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The business identity could not be saved. Please try again.");

  // Keep the business record in step so other screens show the same details.
  await supabaseAdmin
    .from("businesses")
    .update({
      abn: abn || null,
      ...(payload.website ? { website_url: payload.website } : {}),
    })
    .eq("id", app.businessId);

  const identity = toIdentity(data as Row);

  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: app.businessId,
    userId: app.userId,
    eventType: "business_identity_saved",
    entityType: "business",
    entityId: app.businessId,
    // Never store the full details in the audit trail.
    metadata: { complete: missingIdentityFields(identity).length === 0, abn_last4: abn.slice(-4) },
  });

  return { ok: true, identity, missing: missingIdentityFields(identity) };
}

/**
 * Server-side gate used before a dedicated number is bought or connected.
 * Reads by business id because it runs inside provisioning, not a request.
 */
export async function identityGate(
  businessId: string,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const { data } = await supabaseAdmin
    .from("business_identity")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  const identity = data ? toIdentity(data as Row) : null;
  const missing = missingIdentityFields(identity);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export type AdminIdentityRow = {
  businessId: string;
  businessName: string;
  legalName: string;
  abn: string;
  suburb: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: "pending" | "verified";
  submittedAt: string | null;
  complete: boolean;
  numbers: string[];
};

/** Platform admin only: one place to answer an identity request per number. */
export async function listBusinessIdentities(): Promise<AdminIdentityRow[]> {
  const [{ data: rows }, { data: numbers }] = await Promise.all([
    supabaseAdmin
      .from("business_identity")
      .select("*, businesses(name)")
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("texto_numbers")
      .select("number, assigned_business_id")
      .is("recalled_at", null),
  ]);

  const byBusiness = new Map<string, string[]>();
  for (const row of numbers ?? []) {
    if (!row.assigned_business_id) continue;
    const list = byBusiness.get(row.assigned_business_id) ?? [];
    list.push(row.number);
    byBusiness.set(row.assigned_business_id, list);
  }

  return (rows ?? []).map((raw) => {
    const row = raw as unknown as Row & { businesses: { name: string } | null };
    const identity = toIdentity(row);
    return {
      businessId: row.business_id,
      businessName: row.businesses?.name ?? "",
      legalName: identity.legalName,
      abn: identity.abn,
      suburb: identity.suburb,
      state: identity.state,
      contactName: identity.contactName,
      contactEmail: identity.contactEmail,
      contactPhone: identity.contactPhone,
      status: identity.status,
      submittedAt: identity.declarationAcceptedAt,
      complete: missingIdentityFields(identity).length === 0,
      numbers: byBusiness.get(row.business_id) ?? [],
    };
  });
}
