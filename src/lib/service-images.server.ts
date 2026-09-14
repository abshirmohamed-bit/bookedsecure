/**
 * Service / add-on picture storage: I/O layer.
 *
 * Every write is scoped to the caller's own business, and a picture is only
 * ever attached to a row that already belongs to that business.
 */
import type { AppContext } from "@/lib/app-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TENANT_LOGO_BUCKET, MAX_LOGO_BYTES, ALLOWED_LOGO_TYPES } from "@/lib/tenant-logo";
import {
  isOwnServiceImagePath,
  serviceImageDisplayUrl,
  serviceImagePath,
  validateServiceImageUpload,
  type ServiceImageKind,
} from "@/lib/service-images";

const TABLE: Record<ServiceImageKind, "services" | "service_addons"> = {
  service: "services",
  addon: "service_addons",
};

function requireOwnerRole(app: AppContext): void {
  if (app.role !== "owner") throw new Error("Only the business owner can change service pictures.");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readOwnRow(app: AppContext, kind: ServiceImageKind, rowId: string) {
  const { data } = await supabaseAdmin
    .from(TABLE[kind])
    .select("id, image_storage_path")
    .eq("id", rowId)
    .eq("business_id", app.businessId)
    .maybeSingle();
  if (!data) throw new Error("That item was not found in your business.");
  return data;
}

/** Stores a picture for one of the tenant's own services or extras. */
export async function storeServiceImage(
  app: AppContext,
  input: { kind: ServiceImageKind; id: string; content_type: string; data_base64: string },
): Promise<{ ok: true; imageUrl: string }> {
  requireOwnerRole(app);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(input.data_base64);
  } catch {
    throw new Error("That file could not be read. Try selecting it again.");
  }
  return await storeServiceImageBytes(app, input.kind, input.id, input.content_type, bytes);
}

async function storeServiceImageBytes(
  app: AppContext,
  kind: ServiceImageKind,
  rowId: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ ok: true; imageUrl: string }> {
  const validation = validateServiceImageUpload({ contentType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);

  const existing = await readOwnRow(app, kind, rowId);
  const unique = crypto.randomUUID();
  const path = serviceImagePath(app.businessId, kind, rowId, validation.extension, unique);

  const upload = await supabaseAdmin.storage
    .from(TENANT_LOGO_BUCKET)
    .upload(path, bytes, { contentType: validation.contentType, upsert: false });
  if (upload.error) throw new Error("The picture could not be uploaded. Nothing was changed.");

  const imageUrl = serviceImageDisplayUrl(kind, rowId, unique);
  const { error } = await supabaseAdmin
    .from(TABLE[kind])
    .update({ image_url: imageUrl, image_storage_path: path })
    .eq("id", rowId)
    .eq("business_id", app.businessId);
  if (error) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([path]);
    throw new Error("The picture could not be saved. Nothing was changed.");
  }

  const previous = existing.image_storage_path ?? null;
  if (previous && previous !== path && isOwnServiceImagePath(app.businessId, previous)) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([previous]);
  }
  return { ok: true, imageUrl };
}

/** Removes the picture from one of the tenant's own services or extras. */
export async function clearServiceImage(
  app: AppContext,
  input: { kind: ServiceImageKind; id: string },
): Promise<{ ok: true }> {
  requireOwnerRole(app);
  const existing = await readOwnRow(app, input.kind, input.id);
  const { error } = await supabaseAdmin
    .from(TABLE[input.kind])
    .update({ image_url: null, image_storage_path: null })
    .eq("id", input.id)
    .eq("business_id", app.businessId);
  if (error) throw new Error(error.message);
  const previous = existing.image_storage_path ?? null;
  if (previous && isOwnServiceImagePath(app.businessId, previous)) {
    await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([previous]);
  }
  return { ok: true };
}

/**
 * Copies a picture from the tenant's own website into their storage. Returns
 * false (never throws) when the file is missing, not an image, or too large,
 * so onboarding can carry on without it.
 */
export async function copyServiceImageFromUrl(
  app: AppContext,
  kind: ServiceImageKind,
  rowId: string,
  sourceUrl: string,
): Promise<boolean> {
  try {
    const response = await fetch(sourceUrl, { redirect: "follow" });
    if (!response.ok) return false;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(contentType in ALLOWED_LOGO_TYPES)) return false;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return false;
    await storeServiceImageBytes(app, kind, rowId, contentType, new Uint8Array(buffer));
    return true;
  } catch (error) {
    console.error("[service-images] copy failed", error);
    return false;
  }
}
