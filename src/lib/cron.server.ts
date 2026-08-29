/**
 * Scheduler credential plumbing.
 *
 * The hourly pilot-expiry job runs inside Postgres (pg_cron) and must present
 * the managed cron secret as `Authorization: Bearer …`. Postgres cannot read
 * the server environment, so the secret is mirrored once into the backend-only
 * table `private.cron_credentials` (no client grants, no API exposure) through
 * a service-role security-definer function.
 *
 * Idempotent: the mirror is refreshed whenever a platform admin loads the pilot
 * queue, so a rotated secret propagates without any manual step.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CRON_CREDENTIAL_NAME = "lovable_cron";

export async function syncCronCredential(): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env["LOVABLE_CRON_SECRET"];
  if (!secret) return { ok: false, reason: "LOVABLE_CRON_SECRET is not configured." };

  const { error } = await supabaseAdmin.rpc("set_cron_credential", {
    p_name: CRON_CREDENTIAL_NAME,
    p_secret: secret,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
