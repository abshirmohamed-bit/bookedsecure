/**
 * Tenant account settings: I/O layer.
 *
 * All writes require the owner role for the caller's own business, resolved
 * from the authenticated session (never from a client-supplied tenant id).
 *
 * The four tenant values kept deliberately separate here:
 *  - phone_number            public business callback number (customer-facing)
 *  - sms_senders.phone_number assigned SMS sending line (FROM)
 *  - owner_notification_number owner alert destination (TO, owner SMS only)
 *  - logo_url / logo_storage_path visual branding only, never used in SMS
 */
import type { AppContext } from "@/lib/app-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  maskOwnerNotificationNumber,
  normaliseOwnerNotificationNumber,
  validateOwnerNotificationNumber,
} from "@/lib/owner-phone";
import { TENANT_LOGO_BUCKET, tenantLogoPath, validateLogoUpload } from "@/lib/tenant-logo";
import { sanitiseLogoUrl } from "@/lib/tenant-branding";

/**
 * The stored file stays private; the browser reads it through the app's own
 * public logo route, so the saved address is short, stable and never expires.
 */
function logoDisplayUrl(businessId: string, version: string): string {
  return `/api/public/tenant-logo/${businessId}?v=${version}`;
}

function requireOwnerRole(app: AppContext): void {
  if (app.role !== "owner") {
    throw new Error("Only the business owner can change account settings.");
  }
}

export type TenantAccount = {
  role: AppContext["role"];
  businessName: string;
  /** Owner alert destination, masked for display. */
  ownerNotificationMasked: string;
  ownerNotificationNumber: string | null;
  ownerNotificationName: string | null;
  /** Public business callback number, shown to customers where configured. */
  callbackNumber: string | null;
  /** Assigned SMS sending line (FROM). Platform-managed, read only. */
  sendingLine: string | null;
  logoUrl: string | null;
  hasCustomLogo: boolean;
};

export async function readTenantAccount(app: AppContext): Promise<TenantAccount> {
  const [{ data: business }, { data: sender }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select(
        "name, phone_number, logo_url, logo_storage_path, owner_notification_name, owner_notification_number",
      )
      .eq("id", app.businessId)
      .single(),
    supabaseAdmin
      .from("sms_senders")
      .select("phone_number")
      .eq("business_id", app.businessId)
      .eq("active", true)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);

  const ownerNumber = normaliseOwnerNotificationNumber(business?.owner_notification_number ?? null);

  return {
    role: app.role,
    businessName: business?.name ?? "",
    ownerNotificationMasked: maskOwnerNotificationNumber(ownerNumber),
    ownerNotificationNumber: ownerNumber,
    ownerNotificationName: business?.owner_notification_name ?? null,
    callbackNumber: business?.phone_number ?? null,
    sendingLine: sender?.phone_number ?? null,
    logoUrl: sanitiseLogoUrl(business?.logo_url ?? null),
    hasCustomLogo: Boolean(business?.logo_url),
  };
}

export async function saveOwnerNotificationSettings(
  app: AppContext,
  input: { owner_notification_name: string | null; owner_notification_number: string | null },
): Promise<{ ok: true; ownerNotificationNumber: string | null; masked: string }> {
  requireOwnerRole(app);
  const raw = (input.owner_notification_number ?? "").trim();

  // Cleared on purpose: owner SMS is disabled, nothing else changes.
  let stored: string | null = null;
  if (raw) {
    const result = validateOwnerNotificationNumber(raw);
    if (!result.ok) throw new Error(result.reason);
    stored = result.e164;
  }

  const name = (input.owner_notification_name ?? "").trim() || null;
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({ owner_notification_name: name, owner_notification_number: stored })
    .eq("id", app.businessId);
  if (error) throw new Error(error.message);

  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: app.businessId,
    userId: app.userId,
    eventType: stored ? "owner_notification_number_saved" : "owner_notification_number_cleared",
    entityType: "business",
    entityId: app.businessId,
    // Never store the raw number in the audit trail.
    metadata: { masked: maskOwnerNotificationNumber(stored) },
  });

  return { ok: true, ownerNotificationNumber: stored, masked: maskOwnerNotificationNumber(stored) };
}

function decodeBase64(payload: string): Uint8Array {
  const cleaned = payload.includes(",") ? (payload.split(",").pop() ?? "") : payload;
  const binary = atob(cleaned.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function storeTenantLogo(
  app: AppContext,
  input: { content_type: string; data_base64: string },
): Promise<{ ok: true; logoUrl: string }> {
  requireOwnerRole(app);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(input.data_base64);
  } catch {
    throw new Error("That file could not be read. Try selecting it again.");
  }

  const validation = validateLogoUpload({ contentType: input.content_type, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);

  // Read the current logo first: it stays in place unless the replacement
  // uploads and saves successfully.
  const { data: existing } = await supabaseAdmin
    .from("businesses")
    .select("logo_url, logo_storage_path")
    .eq("id", app.businessId)
    .single();

  const unique = crypto.randomUUID();
  const path = tenantLogoPath(app.businessId, validation.extension, unique);
  const upload = await supabaseAdmin.storage
    .from(TENANT_LOGO_BUCKET)
    .upload(path, bytes, { contentType: validation.contentType, upsert: false });
  if (upload.error) throw new Error("The logo could not be uploaded. Your current logo is unchanged.");

  const displayUrl = sanitiseLogoUrl(logoDisplayUrl(app.businessId, unique));
  if (!displayUrl) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([path]);
    throw new Error("The logo could not be published. Your current logo is unchanged.");
  }

  const { error } = await supabaseAdmin
    .from("businesses")
    .update({ logo_url: displayUrl, logo_storage_path: path })
    .eq("id", app.businessId);
  if (error) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([path]);
    throw new Error("The logo could not be saved. Your current logo is unchanged.");
  }

  // Only now is the previous file safe to discard.
  const previous = existing?.logo_storage_path ?? null;
  if (previous && previous !== path) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([previous]);
  }

  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: app.businessId,
    userId: app.userId,
    eventType: "business_logo_updated",
    entityType: "business",
    entityId: app.businessId,
    metadata: { replaced: Boolean(previous) },
  });

  return { ok: true, logoUrl: displayUrl };
}

export async function clearTenantLogo(app: AppContext): Promise<{ ok: true }> {
  requireOwnerRole(app);
  const { data: existing } = await supabaseAdmin
    .from("businesses")
    .select("logo_storage_path")
    .eq("id", app.businessId)
    .single();

  const { error } = await supabaseAdmin
    .from("businesses")
    .update({ logo_url: null, logo_storage_path: null })
    .eq("id", app.businessId);
  if (error) throw new Error(error.message);

  if (existing?.logo_storage_path) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([existing.logo_storage_path]);
  }

  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: app.businessId,
    userId: app.userId,
    eventType: "business_logo_removed",
    entityType: "business",
    entityId: app.businessId,
  });

  return { ok: true };
}
