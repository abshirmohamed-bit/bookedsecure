import { startWebChat, replyToWebChat, resumeWebChat } from "@/lib/web-chat.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SLUG = process.env.SLUG!;
const MOB = "+61470111444";
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
  log(`  > ${answer}`);
  s.messages.slice(-2).forEach((m) => log(`    ${m.role}: ${m.body.replace(/\n/g, " | ").slice(0, 130)}`));
  log(`    step=${s.prompt?.step ?? "-"} err=${s.error ? "yes" : "no"} completed=${s.completed} dup=${s.duplicate}`);
  return s;
}

const start = await startWebChat(SLUG);
const cid = start!.conversationId;
const svcId = start!.prompt!.options![0]!.value;
await say(cid, svcId, "service");
await say(cid, "2018 Subaru Forester", "vehicle");
await say(cid, "Newtown", "suburb");
await say(cid, "the car is very dirty inside", "concerns");
await say(cid, "Dana", "name");
await say(cid, MOB, "mobile");
await say(cid, "skip", "email");

log("\n[A] invalid mobile restatement at review (no cue word)");
await say(cid, "my mobile is 12345", "review");
const { data: c1 } = await supabaseAdmin.from("web_conversations").select("collected").eq("id", cid).single();
log("  mobile preserved:", (c1!.collected as { mobile_number?: string }).mobile_number);

log("\n[B] valid mobile restatement at review");
await say(cid, "my mobile is 0470 111 555", "review");

log("\n[C] refresh / resume after a correction");
const resumed = await resumeWebChat(SLUG, cid);
log("  resumed step:", resumed!.prompt?.step, "turns:", resumed!.messages.length);
log("  resumed review text:", resumed!.prompt!.text.replace(/\n/g, " | ").slice(0, 200));
log("  resumed fields:", JSON.stringify(resumed!.prompt!.fields));
log("  cross-tenant resume blocked:", (await resumeWebChat("does-not-exist", cid)) === null);

log("\n[D] change:name directive then answer");
await say(cid, "change:name", "review");
await say(cid, "Dana Rivera", "name");

log("\n[E] confirm + consent");
await say(cid, "confirmed", "review");
const done = await say(cid, "granted", "consent");
log("\n[F] replay consent twice more (idempotency)");
await say(cid, "granted", "consent");
await say(cid, "granted", "consent");

const { data: conv } = await supabaseAdmin
  .from("web_conversations")
  .select("lead_id, collected, status")
  .eq("id", cid)
  .single();
const { data: lead } = await supabaseAdmin
  .from("leads")
  .select("id, name, mobile_number, email, suburb, vehicle_type, main_concerns, service_intent, external_id")
  .eq("id", conv!.lead_id!)
  .single();
log("\nLEAD:", JSON.stringify(lead));
const { data: dupCheck } = await supabaseAdmin
  .from("leads")
  .select("id, deleted_at")
  .eq("business_id", "11111111-1111-1111-1111-111111111111")
  .in("mobile_number", [MOB, "+61470111555"]);
log("leads for both test numbers:", dupCheck);
const { data: jobs } = await supabaseAdmin.from("automation_jobs").select("job_type, step, status").eq("lead_id", lead!.id);
log("automation_jobs:", JSON.stringify(jobs));
const { data: msgs } = await supabaseAdmin.from("messages").select("id, direction").eq("lead_id", lead!.id);
log("messages:", JSON.stringify(msgs));
log("resume after completion returns null:", (await resumeWebChat(SLUG, cid)) === null);
log("completed flag:", done.completed);
