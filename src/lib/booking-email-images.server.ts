/**
 * Pictures for the booking confirmation email.
 *
 * Email clients fetch images when the email is opened, sometimes months
 * later, so they need a permanent public address. Files live in the private
 * tenant-logos bucket under <business>/email/<uuid>.<ext>; the public route
 * /api/public/email-image/<business>/<name> serves only names of that shape
 * from that business's own folder, so nothing else can be read through it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EMAIL_IMAGE_NAME, EMAIL_IMAGE_TYPES, type EmailImageType, imageBytesMatch, MAX_EMAIL_IMAGE_BYTES } from "@/lib/booking-email";
import { TENANT_LOGO_BUCKET } from "@/lib/tenant-logo";

function appOrigin(): string {
  return process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
}

export function emailImagePath(businessId: string, name: string): string | null {
  return EMAIL_IMAGE_NAME.test(name) ? `${businessId}/email/${name}` : null;
}

export function emailImageUrl(businessId: string, name: string): string {
  return `${appOrigin()}/api/public/email-image/${businessId}/${name}`;
}

export async function storeEmailImage(businessId: string, contentType: EmailImageType, dataBase64: string): Promise<{ url: string; name: string }> {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(Buffer.from(dataBase64, "base64")); } catch { throw new Error("That picture could not be read."); }
  if (bytes.byteLength < 64) throw new Error("That picture could not be read.");
  if (bytes.byteLength > MAX_EMAIL_IMAGE_BYTES) throw new Error("Pictures for emails must be under 2 MB.");
  if (!imageBytesMatch(contentType, bytes)) throw new Error("That file isn't the kind of picture it says it is.");
  const name = `${crypto.randomUUID()}.${EMAIL_IMAGE_TYPES[contentType]}`;
  const path = emailImagePath(businessId, name)!;
  const { error } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error("The picture could not be uploaded.");
  return { url: emailImageUrl(businessId, name), name };
}
