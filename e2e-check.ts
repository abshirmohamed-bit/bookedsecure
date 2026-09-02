import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LEAD = process.env.LEAD!;
const CID = process.env.CID!;

const { data: jobs } = await supabaseAdmin.from("automation_jobs").select("*").eq("lead_id", LEAD);
console.log("automation_jobs:", JSON.stringify(jobs, null, 1));
const { data: convs } = await supabaseAdmin.from("conversations").select("*").eq("lead_id", LEAD);
console.log("conversations:", JSON.stringify(convs, null, 1));
const { data: msgs } = await supabaseAdmin.from("messages").select("id, direction, status, body").eq("lead_id", LEAD);
console.log("messages:", JSON.stringify(msgs));

// resume-after-correction: reload state exactly as a browser refresh would
const { getWebChatState } = await import("@/lib/web-chat.server").then((m) => m as never).catch(() => ({}) as never);
console.log("has resume export:", typeof getWebChatState);
const { data: conv } = await supabaseAdmin
  .from("web_conversations")
  .select("collected, status, lead_id")
  .eq("id", CID)
  .single();
console.log("persisted collected:", JSON.stringify(conv!.collected));
