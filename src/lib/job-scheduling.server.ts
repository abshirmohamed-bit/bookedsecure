import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Atomic save: the database updates the job and lead together, or neither. */
export async function saveScheduledJob(
  client: SupabaseClient<Database>,
  input: { businessId: string; leadId: string; scheduledAt: string },
) {
  const { data, error } = await client.rpc("schedule_owner_job", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_scheduled_at: input.scheduledAt,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("That time is already booked. Choose another time; nothing was saved.");
    }
    throw new Error(error.message || "Could not save the booking. Please try again.");
  }
  if (!data) throw new Error("Could not save the booking. Please try again.");
  return { ok: true, jobId: data };
}