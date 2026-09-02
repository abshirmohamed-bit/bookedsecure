// Temporary hardening harness (deleted after the run). Drives the real public
// AI chat server path against the live database with synthetic Glocast data.
import { startWebChat, replyToWebChat, resumeWebChat } from "@/lib/web-chat.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SLUG = "glocast";
const created: { leads: string[]; conversations: string[] } = { leads: [], conversations: [] };

function log(label: string, value: unknown) {
  console.log(`\n### ${label}\n` + JSON.stringify(value, null, 2));
}

async function drive(mobile: string, name: string) {
  const start = await startWebChat(SLUG);
  if (!start) throw new Error("chat not available");
  created.conversations.push(start.conversationId);
  let state = start;
  const answer = async (value: string) => {
    const next = await replyToWebChat({
      slug: SLUG,
      conversationId: start.conversationId,
      answer: value,
      formUrl: "https://harden.test/quote/glocast",
      expectedStep: state.prompt?.step ?? null,
    });
    if (!next) throw new Error("conversation gone");
    state = next;
    return next;
  };

  const serviceId = state.prompt?.options?.find((o) => /full interior detail/i.test(o.label))?.value;
  if (!serviceId) throw new Error("pilot service not offered");
  await answer(serviceId);
  await answer("SUV");
  await answer("Marrickville");
  await answer("Interior needs a deep clean");
  await answer(name);
  await answer(mobile);
  await answer("skip");
  await answer("yes");
  await answer("granted");
  return { conversationId: start.conversationId, state };
}

async function leadFor(mobile: string) {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, name, suburb, vehicle_type, main_concerns, status, service_name_snapshot")
    .eq("mobile_number", mobile)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

async function snapshot(leadIds: string[]) {
  const [offers, jobs, messages, usage, autos, notes] = await Promise.all([
    supabaseAdmin.from("booking_offers").select("id, lead_id, slot_start, status, job_id, timezone").in("lead_id", leadIds),
    supabaseAdmin.from("jobs").select("id, lead_id, scheduled_at, completion_status").in("lead_id", leadIds),
    supabaseAdmin.from("messages").select("id, lead_id").in("lead_id", leadIds),
    supabaseAdmin.from("ai_usage_events").select("id, lead_id").in("lead_id", leadIds),
    supabaseAdmin.from("automation_jobs").select("id, lead_id, job_type, status").in("lead_id", leadIds),
    supabaseAdmin.from("notifications").select("id, lead_id, kind").in("lead_id", leadIds),
  ]);
  return {
    offers: offers.data ?? [],
    jobs: jobs.data ?? [],
    sms_messages: (messages.data ?? []).length,
    ai_usage_events: (usage.data ?? []).length,
    automation_jobs: autos.data ?? [],
    notifications: notes.data ?? [],
  };
}

const MOBILE_A = "+61447850011";
const MOBILE_B = "+61447850012";
const MOBILE_C = "+61447850013";
const MOBILE_D = "+61447850014";

// ---- Scenario 1: slot conflict -------------------------------------------
const a = await drive(MOBILE_A, "Harden A");
const b = await drive(MOBILE_B, "Harden B");
const leadA = await leadFor(MOBILE_A);
const leadB = await leadFor(MOBILE_B);
created.leads.push(leadA!.id, leadB!.id);

const offerA = a.state.prompt!.options![0]!.value;
const labelA = a.state.prompt!.options![0]!.label;
const rivalB = b.state.prompt!.options!.find((o) => o.label === labelA)!.value;

const winner = await replyToWebChat({
  slug: SLUG, conversationId: a.conversationId, answer: offerA,
  formUrl: null, expectedStep: "booking",
});
const loser = await replyToWebChat({
  slug: SLUG, conversationId: b.conversationId, answer: rivalB,
  formUrl: null, expectedStep: "booking",
});
log("scenario 1 — contested slot", { labelA });
log("scenario 1 — winner", {
  status: winner!.status, completed: winner!.completed, last: winner!.messages.at(-1)?.body,
});
log("scenario 1 — loser", {
  status: loser!.status, completed: loser!.completed, prompt_step: loser!.prompt?.step,
  fresh_options: loser!.prompt?.options?.map((o) => o.label),
  last_two: loser!.messages.slice(-2).map((m) => `${m.role}: ${m.body}`),
});
log("scenario 1 — db", await snapshot([leadA!.id, leadB!.id]));

// ---- Scenario 4: replay of the winning selection -------------------------
const replay = await replyToWebChat({
  slug: SLUG, conversationId: a.conversationId, answer: offerA,
  formUrl: null, expectedStep: "booking",
});
log("scenario 4 — replay", { status: replay!.status, completed: replay!.completed });
log("scenario 4 — db", await snapshot([leadA!.id]));
log("scenario 4 — resume of completed conversation", await resumeWebChat(SLUG, a.conversationId));

// ---- Scenario 2: expired offer ------------------------------------------
const c = await drive(MOBILE_C, "Harden C");
const leadC = await leadFor(MOBILE_C);
created.leads.push(leadC!.id);
const offerC = c.state.prompt!.options![0]!.value;
await supabaseAdmin
  .from("booking_offers")
  .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
  .eq("lead_id", leadC!.id);
const expired = await replyToWebChat({
  slug: SLUG, conversationId: c.conversationId, answer: offerC,
  formUrl: null, expectedStep: "booking",
});
log("scenario 2 — expired selection", {
  status: expired!.status, completed: expired!.completed, prompt_step: expired!.prompt?.step,
  options: expired!.prompt?.options?.map((o) => o.label),
  transcript_tail: expired!.messages.slice(-3).map((m) => `${m.role}: ${m.body}`),
});
log("scenario 2 — db", await snapshot([leadC!.id]));

// ---- Scenario 3: refresh and resume ------------------------------------
const d = await drive(MOBILE_D, "Harden D");
const leadD = await leadFor(MOBILE_D);
created.leads.push(leadD!.id);
const resumed = await resumeWebChat(SLUG, d.conversationId);
log("scenario 3 — resume at booking step", {
  step: resumed?.prompt?.step, options: resumed?.prompt?.options?.map((o) => o.label),
});
log("scenario 3 — resume under another tenant slug", await resumeWebChat("does-not-exist", d.conversationId));
const pickedD = resumed!.prompt!.options![0]!.value;
const bookedD = await replyToWebChat({
  slug: SLUG, conversationId: d.conversationId, answer: pickedD,
  formUrl: null, expectedStep: "booking",
});
log("scenario 3 — booking after resume", {
  status: bookedD!.status, completed: bookedD!.completed, last: bookedD!.messages.at(-1)?.body,
});
log("scenario 3 — db", await snapshot([leadD!.id]));

// ---- Field fidelity + timezone -----------------------------------------
log("lead field fidelity", { leadA, leadB, leadC, leadD: await leadFor(MOBILE_D) });
log("created ids", created);
