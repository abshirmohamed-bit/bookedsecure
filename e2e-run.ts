import { startWebChat, replyToWebChat } from "@/lib/web-chat.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SLUG = process.env.SLUG!;
const MOB = "+61470111222";
const log = (...a: unknown[]) => console.log(...a);

async function say(cid: string, answer: string, expected?: string | null) {
  const s = await replyToWebChat({
    slug: SLUG,
    conversationId: cid,
    answer,
    formUrl: "https://test.local/quote",
    expectedStep: expected ?? null,
  });
  if (!s) throw new Error("no state");
  const last = s.messages.slice(-2).map((m) => `${m.role}: ${m.body.replace(/\n/g, " | ").slice(0, 140)}`);
  log(`  > ${answer}`);
  last.forEach((l) => log(`    ${l}`));
  log(`    step=${s.prompt?.step ?? "-"} err=${s.error ? "yes" : "no"} completed=${s.completed} dup=${s.duplicate}`);
  return s;
}

const { data: biz } = await supabaseAdmin
  .from("businesses")
  .select("id, name, slug, quote_mode")
  .eq("slug", SLUG)
  .single();
log("tenant", biz);
const bizId = biz!.id;

const { data: priorLeads } = await supabaseAdmin
  .from("leads")
  .select("id")
  .eq("business_id", bizId)
  .eq("mobile_number", MOB);
log("pre-existing leads for test mobile:", priorLeads?.length ?? 0);

const start = await startWebChat(SLUG);
if (!start) throw new Error("chat unavailable (tenant not ai_chat mode?)");
const cid = start.conversationId;
log("conversation", cid, "first step", start.prompt?.step);
const svcId = start.prompt!.options![0]!.value;
const svc2 = start.prompt!.options![1]?.value ?? svcId;

log("\n[1] service select");
await say(cid, svcId, "service");
log("\n[2] vehicle");
await say(cid, "2019 Mazda CX-5", "vehicle");
log("\n[3] suburb");
await say(cid, "Bondi", "suburb");
log("\n[4] concerns");
await say(cid, "swirls and pet hair", "concerns");
log("\n[5] name");
await say(cid, "Abshir", "name");
log("\n[6] NAME correction while MOBILE is active");
await say(cid, "actually my name is Abshiro", "mobile");
log("\n[7] ambiguous correction, no named field");
await say(cid, "actually that was wrong", "mobile");
log("\n[8] two fields named");
await say(cid, "actually change my name and my suburb", "mobile");
log("\n[9] invalid mobile replacement");
await say(cid, "my mobile is 12345", "mobile");
log("\n[10] valid mobile");
await say(cid, MOB, "mobile");
log("\n[11] MOBILE correction while EMAIL active");
await say(cid, "sorry my number should be 0470 111 333", "email");
log("\n[12] repeated correction same field");
await say(cid, "actually change my mobile to 0470 111 222", "email");
log("\n[13] vehicle correction while email active");
await say(cid, "change my car to a 2021 Toyota Hilux", "email");
log("\n[14] suburb correction");
await say(cid, "change my suburb to Parramatta", "email");
log("\n[15] email answer");
await say(cid, "abshiro@example.com", "email");
log("\n[16] email correction after all fields collected (review active)");
await say(cid, "actually my email is abshiro.b@example.com", "review");
log("\n[17] service correction at review");
await say(cid, "actually change my service", "review");
await say(cid, svc2, "service");
log("\n[18] review directive change:suburb");
await say(cid, "change:suburb", "review");
await say(cid, "Ryde", "suburb");
log("\n[19] review directive change:concerns");
await say(cid, "change:concerns", "review");
await say(cid, "heavy water spots", "concerns");
log("\n[20] confirm review");
await say(cid, "confirmed", "review");
const { data: preConsent } = await supabaseAdmin
  .from("web_conversations")
  .select("collected")
  .eq("id", cid)
  .single();
log("collected before consent:", JSON.stringify(preConsent!.collected));
log("\n[21] consent granted");
await say(cid, "granted", "consent");
log("\n[22] idempotent replay of final submission");
await say(cid, "granted", "consent");

const { data: conv } = await supabaseAdmin
  .from("web_conversations")
  .select("lead_id, collected, status, requires_owner_review")
  .eq("id", cid)
  .single();
log("\nconversation final:", conv!.status, "lead", conv!.lead_id, "ownerReview", conv!.requires_owner_review);
const { data: lead } = await supabaseAdmin
  .from("leads")
  .select(
    "id, name, mobile_number, email, suburb, vehicle_type, main_concerns, service_intent, service_name_snapshot, external_id, requires_owner_review, deleted_at, lead_origin",
  )
  .eq("id", conv!.lead_id!)
  .single();
log("LEAD:", JSON.stringify(lead, null, 1));

const { data: allLeads } = await supabaseAdmin
  .from("leads")
  .select("id, created_at, deleted_at")
  .eq("business_id", bizId)
  .eq("mobile_number", MOB);
log("leads with test mobile:", allLeads);

for (const tbl of ["messages", "automation_jobs", "usage_events", "conversations"]) {
  const { data, error } = await supabaseAdmin
    .from(tbl as never)
    .select("id")
    .eq("lead_id", conv!.lead_id!);
  log(`${tbl}:`, error ? `err ${error.message}` : (data as unknown[]).length);
}
const { data: transcript } = await supabaseAdmin
  .from("web_conversation_messages")
  .select("role, body")
  .eq("conversation_id", cid)
  .order("created_at");
log("\nTRANSCRIPT customer turns:");
transcript!.filter((t) => t.role === "customer").forEach((t) => log(" -", t.body));
log("total turns:", transcript!.length);
log("CONVERSATION_ID", cid);
