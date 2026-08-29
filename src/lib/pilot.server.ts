// Server-only helpers for pilot applications (platform-level, not tenant-scoped).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Client = SupabaseClient<Database>;

/**
 * Pilot applications are platform records, not tenant records, so access is
 * gated on the existing `platform_admin` role rather than a business_id.
 */
export async function requirePlatformAdmin(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only platform administrators can access pilot applications.");
  return userId;
}

export async function auditPilotEvent(input: {
  userId?: string | null;
  eventType: string;
  applicationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await supabaseAdmin.from("audit_events").insert({
    business_id: null,
    user_id: input.userId ?? null,
    event_type: input.eventType,
    entity_type: "pilot_application",
    entity_id: input.applicationId,
    metadata: (input.metadata ?? null) as never,
  });
}
