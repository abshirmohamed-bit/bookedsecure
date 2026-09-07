// Server-only lookup of the campaign discount that applies to one contact.
// The percentage is read from the tenant's own approved campaign offer text.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseOfferPercent } from "@/lib/service-pricing";

/**
 * The discount percentage a returning contact should see highlighted, taken
 * from the most recent win-back message actually sent to them. Returns null
 * when there is no campaign, no offer text, or no percentage in it.
 */
export async function campaignOfferPercent(
  businessId: string,
  leadId: string | null | undefined,
): Promise<number | null> {
  if (!leadId) return null;
  const { data: draft } = await supabaseAdmin
    .from("reactivation_drafts")
    .select("campaign_id, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!draft?.campaign_id) return null;
  const { data: campaign } = await supabaseAdmin
    .from("reactivation_campaigns")
    .select("offer_text, status")
    .eq("business_id", businessId)
    .eq("id", draft.campaign_id)
    .maybeSingle();
  if (!campaign || campaign.status === "cancelled") return null;
  return parseOfferPercent(campaign.offer_text);
}
