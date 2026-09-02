import { startWebChat, replyToWebChat } from "@/lib/web-chat.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { commitWebChatBooking } from "@/lib/web-chat-booking.server";
const SLUG = "glocast";
const MOBILE = "+61447850023";
const start = await startWebChat(SLUG);
let state = start!;
const answer = async (v: string) => {
  const n = await replyToWebChat({ slug: SLUG, conversationId: start!.conversationId, answer: v, formUrl: null, expectedStep: state.prompt?.step ?? null });
  state = n!; return n!;
};
await answer(state.prompt!.options!.find((o) => /full interior detail/i.test(o.label))!.value);
for (const v of ["SUV", "Marrickville", "Interior needs a deep clean", "Harden E", MOBILE, "skip", "yes", "granted"]) await answer(v);
const { data: lead } = await supabaseAdmin.from("leads").select("id").eq("mobile_number", MOBILE).order("created_at", { ascending: false }).limit(1).single();
const offer = state.prompt!.options![0]!.value;
await supabaseAdmin.from("booking_offers").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("lead_id", lead!.id);
const expired = await replyToWebChat({ slug: SLUG, conversationId: start!.conversationId, answer: offer, formUrl: null, expectedStep: "booking" });
console.log(JSON.stringify({ step: expired!.prompt?.step, tail: expired!.messages.slice(-2).map((m) => `${m.role}: ${m.body}`), options: expired!.prompt?.options?.map((o) => o.label) }, null, 2));
// cross-tenant / cross-lead offer rejection, live
const { data: offers } = await supabaseAdmin.from("booking_offers").select("id").eq("lead_id", lead!.id).limit(1);
console.log("cross-tenant commit:", JSON.stringify(await commitWebChatBooking({ businessId: "22222222-2222-2222-2222-222222222222", leadId: lead!.id, conversationId: start!.conversationId, offerId: offers![0]!.id })));
console.log("lead", lead!.id, "conversation", start!.conversationId);
