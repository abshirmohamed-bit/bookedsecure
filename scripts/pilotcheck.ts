import { supabaseAdmin } from "@/integrations/supabase/client.server";
const r = await supabaseAdmin.from("pilot_applications").select("id, business_id, access_state").eq("business_id","11111111-1111-1111-1111-111111111111").order("created_at",{ascending:false}).limit(1).maybeSingle();
console.log(JSON.stringify(r));
const r2 = await supabaseAdmin.from("pilot_applications").select("id, business_id, access_state").eq("business_id","11111111-1111-1111-1111-111111111111").limit(1).maybeSingle();
console.log(JSON.stringify(r2));
