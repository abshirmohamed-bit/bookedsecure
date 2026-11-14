/**
 * Co-Work gateways (Hermes phase 3): the owner or a team member messages
 * Co-Work by text (to the business's own number, from their verified mobile),
 * email (to their secret cowork-<token>@bookedsecure.com, from their verified
 * address) or Telegram (the BookedSecure bot, linked with a one-time code).
 *
 * Webhooks only queue the message (cowork_gateway_messages, one row per
 * provider id); sweepGateways, called by the database as soon as a row is
 * queued (docs/cowork-gateways-trigger.sql), answers it with the same
 * Co-Work agent and thread store, limited to reading and preparing. The answer
 * goes back to the verified number, address or chat only. Every query is
 * filtered by the gateway's own business; the person must still be an active
 * member with an active plan.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CODE_ATTEMPTS, CODE_RESEND_MS, CODE_TTL_MS, GATEWAY_DAILY_LIMIT, GATEWAY_LABEL, GATEWAY_MESSAGE_MAX, GATEWAY_STALE_MS,
  fitSms, fitTelegram, gatewayEmailAddress, gatewayRequest, gatewayTokenFrom, hashCode, isAutomaticEmail, isPauseWord,
  plainText, randomCode, randomToken, telegramCommand, type GatewayChannel,
} from "@/lib/cowork-gateway";

export const GATEWAYS_OFF = "Messaging Co-Work by text, email or Telegram is waiting for a database update (docs/cowork-gateways.sql).";

// The tables arrive with docs/cowork-gateways.sql; until the generated types
// include them, they are reached through this untyped handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as unknown as SupabaseClient<any>;

type GatewayRow = {
  id: string; business_id: string; user_id: string; channel: GatewayChannel; address: string | null; token: string | null;
  verify_code_hash: string | null; verify_sent_at: string | null; verify_attempts: number; verified_at: string | null;
  enabled: boolean; thread_id: string | null; last_message_at: string | null;
};
type MessageRow = {
  id: string; gateway_id: string; business_id: string; channel: GatewayChannel; external_id: string; body: string;
  meta: Record<string, unknown> | null; status: string; started_at: string | null; created_at: string;
};

const GATEWAY_COLUMNS = "id, business_id, user_id, channel, address, token, verify_code_hash, verify_sent_at, verify_attempts, verified_at, enabled, thread_id, last_message_at";
const isMissing = (e: { code?: string } | null | undefined) => Boolean(e && ["PGRST205", "42P01", "PGRST204", "42703"].includes(e.code ?? ""));
const origin = () => process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
const threadLink = (threadId: string) => `${origin()}/assistant/${threadId}`;

// ---------------------------------------------------------------- linking

export type GatewayView = {
  channel: GatewayChannel;
  address: string | null;
  verified: boolean;
  enabled: boolean;
  /** email: where to write. */
  writeTo: string | null;
  /** A code was sent and is waiting to be typed in. */
  awaitingCode: boolean;
  threadId: string | null;
  lastMessageAt: string | null;
};

function view(row: GatewayRow): GatewayView {
  return {
    channel: row.channel,
    address: row.channel === "telegram" ? (row.verified_at ? "Linked chat" : null) : row.address,
    verified: Boolean(row.verified_at),
    enabled: row.enabled,
    writeTo: row.channel === "email" && row.token && row.verified_at ? gatewayEmailAddress(row.token) : null,
    awaitingCode: !row.verified_at && Boolean(row.verify_code_hash) && Date.now() - Date.parse(row.verify_sent_at ?? "") < CODE_TTL_MS,
    threadId: row.thread_id,
    lastMessageAt: row.last_message_at,
  };
}

async function businessNumber(businessId: string): Promise<string | null> {
  const { resolveSender } = await import("@/lib/lead-engine.server");
  const sender = await resolveSender({ businessId }).catch(() => null);
  return sender?.phoneNumber ?? null;
}

/** This person's gateways, and what can be set up for this business. */
export async function listGateways(businessId: string, userId: string) {
  const { data, error } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS).eq("business_id", businessId).eq("user_id", userId);
  const { data: biz } = await supabaseAdmin.from("businesses").select("owner_notification_number").eq("id", businessId).maybeSingle();
  const base = {
    businessNumber: await businessNumber(businessId),
    telegramReady: telegramConfigured(),
    suggestedMobile: (biz?.owner_notification_number as string | null) ?? null,
  };
  if (error) {
    if (isMissing(error)) return { setupMissing: true as const, gateways: [] as GatewayView[], ...base };
    throw new Error(error.message);
  }
  return { setupMissing: false as const, gateways: ((data ?? []) as GatewayRow[]).map(view), ...base };
}

async function rowFor(businessId: string, userId: string, channel: GatewayChannel): Promise<GatewayRow | null> {
  const { data, error } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS)
    .eq("business_id", businessId).eq("user_id", userId).eq("channel", channel).maybeSingle();
  if (error) throw new Error(isMissing(error) ? GATEWAYS_OFF : error.message);
  return (data as GatewayRow | null) ?? null;
}

async function upsertRow(businessId: string, userId: string, channel: GatewayChannel, patch: Record<string, unknown>): Promise<GatewayRow> {
  const { data, error } = await db.from("cowork_gateways")
    .upsert({ business_id: businessId, user_id: userId, channel, updated_at: new Date().toISOString(), ...patch }, { onConflict: "business_id,user_id,channel" })
    .select(GATEWAY_COLUMNS).single();
  if (error) throw new Error(isMissing(error) ? GATEWAYS_OFF : error.message);
  return data as GatewayRow;
}

function tooSoon(row: GatewayRow | null): boolean {
  return Boolean(row?.verify_sent_at && Date.now() - Date.parse(row.verify_sent_at) < CODE_RESEND_MS);
}

/** Sends a code to the mobile from the business's own number. */
export async function startSmsLink(input: { businessId: string; userId: string; mobile: string }) {
  const { normaliseAuMobile } = await import("@/lib/domain");
  const mobile = normaliseAuMobile(input.mobile);
  if (!mobile) throw new Error("Enter an Australian mobile number.");
  if (!(await businessNumber(input.businessId))) throw new Error("Your business needs its own texting number first (Settings, Text messages).");
  const existing = await rowFor(input.businessId, input.userId, "sms");
  if (tooSoon(existing)) throw new Error("A code was just sent. Wait a minute before asking for another.");
  const { data: clash } = await db.from("cowork_gateways").select("id, user_id").eq("business_id", input.businessId)
    .eq("channel", "sms").eq("address", mobile).not("verified_at", "is", null).neq("user_id", input.userId).limit(1);
  if (clash?.length) throw new Error("Someone else on your team already texts Co-Work from that number.");
  const row = await upsertRow(input.businessId, input.userId, "sms", { address: mobile, verified_at: null, enabled: true, verify_attempts: 0, verify_sent_at: new Date().toISOString() });
  const code = randomCode();
  await db.from("cowork_gateways").update({ verify_code_hash: await hashCode(row.id, code) }).eq("id", row.id);
  const { sendOwnerText } = await import("@/lib/owner-schedule-reminder.server");
  const sent = await sendOwnerText({ businessId: input.businessId, to: mobile, parts: [`Your BookedSecure code to text Co-Work: ${code}. It expires in 15 minutes.`] });
  if (!sent.ok) throw new Error(`The code couldn't be sent: ${sent.reason}`);
  return { ok: true as const };
}

/** Links an email address: the login email at once, any other after a code. */
export async function startEmailLink(input: { businessId: string; userId: string; address: string; loginEmail: string | null }) {
  const address = input.address.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 200) throw new Error("Enter a valid email address.");
  if (address.endsWith("@bookedsecure.com")) throw new Error("Use your own email address, not a BookedSecure one.");
  const existing = await rowFor(input.businessId, input.userId, "email");
  const token = existing?.token ?? randomToken(24);
  if (input.loginEmail && address === input.loginEmail.trim().toLowerCase()) {
    await upsertRow(input.businessId, input.userId, "email", { address, token, verified_at: new Date().toISOString(), verify_code_hash: null, verify_attempts: 0, enabled: true });
    return { ok: true as const, verified: true };
  }
  if (tooSoon(existing)) throw new Error("A code was just sent. Wait a minute before asking for another.");
  const row = await upsertRow(input.businessId, input.userId, "email", { address, token, verified_at: null, enabled: true, verify_attempts: 0, verify_sent_at: new Date().toISOString() });
  const code = randomCode();
  await db.from("cowork_gateways").update({ verify_code_hash: await hashCode(row.id, code) }).eq("id", row.id);
  const { sendEmailViaResend } = await import("@/lib/email-campaigns.server");
  const { PLATFORM_FROM_ADDRESS } = await import("@/lib/email-campaigns");
  const text = `Your BookedSecure code to email Co-Work: ${code}\n\nType it into Co-Work to finish. It expires in 15 minutes. If you didn't ask for this, ignore this email.`;
  await sendEmailViaResend({ from: `BookedSecure <${PLATFORM_FROM_ADDRESS}>`, to: address, subject: `Your Co-Work code: ${code}`, text });
  return { ok: true as const, verified: false };
}

/** Checks a code typed in Co-Work. */
export async function confirmGatewayCode(input: { businessId: string; userId: string; channel: "sms" | "email"; code: string }) {
  const row = await rowFor(input.businessId, input.userId, input.channel);
  if (!row || row.verified_at) throw new Error("There's no code waiting. Ask for a new one.");
  if (!row.verify_code_hash || Date.now() - Date.parse(row.verify_sent_at ?? "") > CODE_TTL_MS) throw new Error("That code has expired. Ask for a new one.");
  if (row.verify_attempts >= CODE_ATTEMPTS) throw new Error("Too many tries. Ask for a new code.");
  if ((await hashCode(row.id, input.code)) !== row.verify_code_hash) {
    await db.from("cowork_gateways").update({ verify_attempts: row.verify_attempts + 1 }).eq("id", row.id);
    throw new Error("That code isn't right.");
  }
  await db.from("cowork_gateways").update({ verified_at: new Date().toISOString(), verify_code_hash: null, verify_attempts: 0, enabled: true, updated_at: new Date().toISOString() }).eq("id", row.id);
  if (input.channel === "sms" && row.address) {
    const { sendOwnerText } = await import("@/lib/owner-schedule-reminder.server");
    await sendOwnerText({ businessId: input.businessId, to: row.address, parts: [`You're connected. Text this number any time to ask Co-Work, e.g. "what's on today?". Text PAUSE to stop.`] }).catch(() => undefined);
  }
  return { ok: true as const };
}

/** A one-time t.me link that connects the person's Telegram chat. */
export async function startTelegramLink(input: { businessId: string; userId: string }) {
  if (!telegramConfigured()) throw new Error("Telegram isn't set up for BookedSecure yet.");
  await ensureTelegramWebhook();
  const token = randomToken(32);
  await upsertRow(input.businessId, input.userId, "telegram", { token, address: null, verified_at: null, enabled: true, verify_sent_at: new Date().toISOString(), verify_attempts: 0 });
  const username = await telegramUsername();
  if (!username) throw new Error("The Telegram bot couldn't be reached.");
  return { url: `https://t.me/${username}?start=${token}` };
}

export async function setGatewayEnabled(input: { businessId: string; userId: string; channel: GatewayChannel; enabled: boolean }) {
  const { error } = await db.from("cowork_gateways").update({ enabled: input.enabled, updated_at: new Date().toISOString() })
    .eq("business_id", input.businessId).eq("user_id", input.userId).eq("channel", input.channel);
  if (error) throw new Error(isMissing(error) ? GATEWAYS_OFF : error.message);
}

export async function removeGateway(input: { businessId: string; userId: string; channel: GatewayChannel }) {
  const row = await rowFor(input.businessId, input.userId, input.channel);
  if (!row) return;
  if (row.channel === "telegram" && row.address && row.verified_at) {
    await telegramSend(row.address, "This chat is no longer connected to Co-Work.").catch(() => undefined);
  }
  await db.from("cowork_gateways").delete().eq("id", row.id).eq("business_id", input.businessId);
}

// ---------------------------------------------------------------- inbound

/** A verified, switched-on text gateway for this mobile at this business, if any. */
export async function smsGatewayFor(businessId: string, mobile: string): Promise<GatewayRow | null> {
  const { data, error } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS)
    .eq("business_id", businessId).eq("channel", "sms").eq("address", mobile).not("verified_at", "is", null).limit(1).maybeSingle();
  if (error) return null; // no table yet: texts work exactly as before
  return (data as GatewayRow | null) ?? null;
}

/**
 * A text from a linked mobile. PAUSE/STOP switches the gateway off (no reply);
 * anything else is queued for Co-Work. Returns false when this text isn't for
 * Co-Work (paused gateway), so it is handled like any other inbound text.
 */
export async function queueInboundSms(gateway: GatewayRow, input: { providerMessageId: string; body: string }): Promise<boolean> {
  if (!gateway.enabled) return false;
  if (isPauseWord(input.body)) {
    await db.from("cowork_gateways").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", gateway.id);
    return true;
  }
  await queue(gateway, `sms:${input.providerMessageId}`, input.body, {});
  return true;
}

/** Mail to cowork-<token>@bookedsecure.com from the verified address. Anything else is dropped quietly. */
export async function handleGatewayEmail(email: import("@/lib/email-inbox.server").ReceivedEmail, hintedTo: string[] = []): Promise<{ handled: boolean; reason?: string }> {
  const token = gatewayTokenFrom([...(email.to ?? []), ...hintedTo]);
  if (!token) return { handled: false };
  const { data, error } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS).eq("token", token).eq("channel", "email").maybeSingle();
  if (error || !data) return { handled: true, reason: "unknown gateway" };
  const gateway = data as GatewayRow;
  const { parseAddress, htmlToText, stripQuotedReply } = await import("@/lib/email-inbound");
  const from = parseAddress(email.from).email.toLowerCase();
  if (!gateway.verified_at || !gateway.enabled || from !== gateway.address) return { handled: true, reason: "not the linked sender" };
  if (isAutomaticEmail(email.from, email.headers)) return { handled: true, reason: "automatic email" };
  const body = stripQuotedReply(email.text?.trim() ? email.text : htmlToText(email.html ?? "")).trim();
  const subject = (email.subject ?? "").replace(/^(re|fwd?):\s*/i, "").trim();
  const text = body || subject;
  if (!text) return { handled: true, reason: "empty" };
  await queue(gateway, `email:${email.id}`, subject && body && !/^co-?work$/i.test(subject) ? `${subject}\n${body}` : text, {
    subject: email.subject ?? null, messageId: email.message_id ?? null,
  });
  return { handled: true, reason: "queued" };
}

type TelegramUpdate = {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean } };
};

/** One Telegram update from the webhook. Only private chats with text count. */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<{ handled: boolean; reason?: string }> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private" || message.from?.is_bot) return { handled: false, reason: "ignored" };
  const chatId = String(message.chat.id);
  const command = telegramCommand(message.text);

  if (command?.command === "start" && command.arg) {
    const { data } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS).eq("token", command.arg.toLowerCase()).eq("channel", "telegram").maybeSingle();
    const row = data as GatewayRow | null;
    if (!row || row.verified_at || Date.now() - Date.parse(row.verify_sent_at ?? "") > CODE_TTL_MS) {
      await telegramSend(chatId, "That link has expired. Open Co-Work and press Connect Telegram again.");
      return { handled: true, reason: "expired link" };
    }
    // A chat talks to one business: an older link from this chat is removed.
    await db.from("cowork_gateways").delete().eq("channel", "telegram").eq("address", chatId).neq("id", row.id);
    await db.from("cowork_gateways").update({ address: chatId, verified_at: new Date().toISOString(), token: null, enabled: true, updated_at: new Date().toISOString() }).eq("id", row.id);
    const { data: biz } = await supabaseAdmin.from("businesses").select("name").eq("id", row.business_id).maybeSingle();
    await telegramSend(chatId, `Connected to Co-Work for ${biz?.name ?? "your business"}. Ask anything, e.g. "what's on today?" or "who's waiting for a reply?". /new starts a fresh conversation, /stop disconnects.`);
    return { handled: true, reason: "linked" };
  }

  const { data } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS).eq("channel", "telegram").eq("address", chatId).not("verified_at", "is", null).maybeSingle();
  const gateway = data as GatewayRow | null;
  if (!gateway) {
    await telegramSend(chatId, "This chat isn't connected yet. In BookedSecure, open Co-Work, press the phone button and choose Connect Telegram.");
    return { handled: true, reason: "not linked" };
  }
  if (command?.command === "stop") {
    await db.from("cowork_gateways").delete().eq("id", gateway.id);
    await telegramSend(chatId, "Disconnected. You can connect again from Co-Work any time.");
    return { handled: true, reason: "unlinked" };
  }
  if (command?.command === "new") {
    await db.from("cowork_gateways").update({ thread_id: null }).eq("id", gateway.id);
    await telegramSend(chatId, "Fresh conversation started. What can I do?");
    return { handled: true, reason: "new thread" };
  }
  if (command?.command === "help" || command?.command === "start") {
    await telegramSend(chatId, "Ask Co-Work anything about your business. Anything that sends, posts or books is prepared for you to approve in Co-Work. /new starts a fresh conversation, /stop disconnects.");
    return { handled: true, reason: "help" };
  }
  if (!gateway.enabled) {
    await telegramSend(chatId, "Co-Work on Telegram is paused. Switch it back on in Co-Work.");
    return { handled: true, reason: "paused" };
  }
  await queue(gateway, `telegram:${update.update_id}`, message.text, {});
  await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  return { handled: true, reason: "queued" };
}

async function queue(gateway: GatewayRow, externalId: string, body: string, meta: Record<string, unknown>) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("cowork_gateway_messages").select("id", { count: "exact", head: true })
    .eq("gateway_id", gateway.id).gte("created_at", since);
  const over = (count ?? 0) >= GATEWAY_DAILY_LIMIT;
  const { error } = await db.from("cowork_gateway_messages").insert({
    gateway_id: gateway.id, business_id: gateway.business_id, channel: gateway.channel, external_id: externalId,
    body: body.slice(0, GATEWAY_MESSAGE_MAX), meta, status: over ? "skipped" : "queued", ...(over ? { error: "daily limit" } : {}),
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  await db.from("cowork_gateways").update({ last_message_at: new Date().toISOString() }).eq("id", gateway.id);
}

// ---------------------------------------------------------------- answering

const RUNS_PER_SWEEP = 3;

/**
 * Answers queued messages: up to three people at once, one message at a time
 * per person. With `budgetMs` it keeps going round while messages are waiting
 * (a person's second message once their first is answered), until the queue
 * is empty or the time is used; without it, one round (the follow-ups fallback).
 */
export async function sweepGateways(options: { now?: Date; budgetMs?: number } = {}) {
  const started = Date.now();
  let answered = 0, failed = 0;
  for (;;) {
    const round = await sweepRound(options.now ?? new Date());
    if ("setupMissing" in round || "error" in round) return round;
    answered += round.answered;
    failed += round.failed;
    if (!options.budgetMs || round.picked === 0 || Date.now() - started > options.budgetMs) break;
  }
  return { answered, failed };
}

async function sweepRound(now: Date): Promise<{ answered: number; failed: number; picked: number } | { setupMissing: true } | { error: string }> {
  const stale = new Date(now.getTime() - GATEWAY_STALE_MS).toISOString();
  const { error: probe } = await db.from("cowork_gateway_messages")
    .update({ status: "failed", error: "interrupted", finished_at: now.toISOString() }).eq("status", "running").lt("started_at", stale);
  if (probe) return isMissing(probe) ? { setupMissing: true as const } : { error: probe.message };

  const [{ data: queued }, { data: running }] = await Promise.all([
    db.from("cowork_gateway_messages").select("id, gateway_id, business_id, channel, external_id, body, meta, status, started_at, created_at")
      .eq("status", "queued").order("created_at", { ascending: true }).limit(30),
    db.from("cowork_gateway_messages").select("gateway_id").eq("status", "running"),
  ]);
  const busy = new Set(((running ?? []) as { gateway_id: string }[]).map((r) => r.gateway_id));
  const picked: MessageRow[] = [];
  for (const row of (queued ?? []) as MessageRow[]) {
    if (busy.has(row.gateway_id) || picked.length >= RUNS_PER_SWEEP) continue;
    busy.add(row.gateway_id);
    picked.push(row);
  }
  const results = await Promise.all(picked.map(async (row) => {
    const { data: claimed } = await db.from("cowork_gateway_messages")
      .update({ status: "running", started_at: new Date().toISOString() }).eq("id", row.id).eq("status", "queued").select("id");
    if (!claimed?.length) return "taken";
    try {
      return await answer(row);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await db.from("cowork_gateway_messages").update({ status: "failed", error: reason.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", row.id);
      return "failed";
    }
  }));
  return { answered: results.filter((r) => r === "done").length, failed: results.filter((r) => r === "failed").length, picked: picked.length };
}

const THREAD_TITLE: Record<GatewayChannel, string> = { sms: "Co-Work by text", email: "Co-Work by email", telegram: "Co-Work on Telegram" };

async function answer(row: MessageRow): Promise<"done" | "skipped"> {
  const { data } = await db.from("cowork_gateways").select(GATEWAY_COLUMNS).eq("id", row.gateway_id).eq("business_id", row.business_id).maybeSingle();
  const gateway = data as GatewayRow | null;
  const finish = (status: "done" | "skipped", patch: Record<string, unknown> = {}) =>
    db.from("cowork_gateway_messages").update({ status, finished_at: new Date().toISOString(), ...patch }).eq("id", row.id);
  if (!gateway?.verified_at || !gateway.enabled || !gateway.address) { await finish("skipped", { error: "gateway off" }); return "skipped"; }

  // Still an active member of this business, with an active plan.
  const { requireWriteContext } = await import("@/lib/app-context.server");
  let app: Awaited<ReturnType<typeof requireWriteContext>>;
  try {
    app = await requireWriteContext(supabaseAdmin as unknown as SupabaseClient<Database>, gateway.user_id);
    if (app.businessId !== gateway.business_id) throw new Error("This account belongs to another business now.");
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Access ended.";
    await reply(gateway, row, `Co-Work couldn't answer: ${reason}`, null).catch(() => undefined);
    await finish("skipped", { error: reason.slice(0, 300) });
    return "skipped";
  }

  const history = await import("@/lib/assistant-history.server");
  let threadId = gateway.thread_id;
  if (threadId) {
    try { await history.assertAssistantThread(gateway.business_id, threadId); } catch { threadId = null; }
  }
  if (!threadId) {
    const t = await history.createAssistantThread({ businessId: gateway.business_id, userId: gateway.user_id });
    threadId = t.id;
    await supabaseAdmin.from("assistant_threads").update({ title: THREAD_TITLE[gateway.channel] }).eq("id", threadId).eq("business_id", gateway.business_id);
    await db.from("cowork_gateways").update({ thread_id: threadId }).eq("id", gateway.id);
  }
  const prior = await history.loadAssistantThread({ businessId: gateway.business_id, threadId });
  const { conversationContext } = await import("@/lib/assistant-context");

  const { runAssistantAgent } = await import("@/lib/assistant-agent.server");
  const result = await runAssistantAgent({
    client: supabaseAdmin as unknown as SupabaseClient<Database>,
    businessId: gateway.business_id, userId: gateway.user_id, role: app.role,
    question: gatewayRequest(gateway.channel, row.body),
    history: conversationContext(prior.messages.slice(-12)),
    gateway: true,
  });
  const done = result.executed.length ? result.executed.join(" ") : null;
  await history.persistOwnerExchange({
    businessId: gateway.business_id, threadId, question: row.body, answer: result.answer, proposals: result.proposals, done,
  });
  const text = result.answer.trim() || done || "Done.";
  const sent = await reply(gateway, row, text, result.proposals.length ? threadId : null, threadId);
  await finish("done", { reply: sent.slice(0, 4000) });
  return "done";
}

/** Sends an answer back through the gateway's own channel, to its verified address only. */
async function reply(gateway: GatewayRow, row: MessageRow, text: string, needsYesThread: string | null, threadId: string | null = needsYesThread): Promise<string> {
  const link = threadId ? threadLink(threadId) : `${origin()}/assistant`;
  if (gateway.channel === "sms") {
    const body = fitSms(text, link, { needsLink: Boolean(needsYesThread) });
    const { sendOwnerText } = await import("@/lib/owner-schedule-reminder.server");
    const sent = await sendOwnerText({ businessId: gateway.business_id, to: gateway.address!, parts: [body] });
    if (!sent.ok) throw new Error(`The answer couldn't be texted: ${sent.reason}`);
    return body;
  }
  if (gateway.channel === "telegram") {
    const body = fitTelegram(text, link, Boolean(needsYesThread));
    await telegramSend(gateway.address!, body);
    return body;
  }
  const { loadEmailBranding, sendEmailViaResend } = await import("@/lib/email-campaigns.server");
  const { renderEmailHtml, renderEmailText } = await import("@/lib/email-template");
  const { businessName, branding } = await loadEmailBranding(gateway.business_id);
  const meta = row.meta ?? {};
  const subject = typeof meta["subject"] === "string" && meta["subject"] ? `Re: ${String(meta["subject"]).replace(/^re:\s*/i, "")}` : "Co-Work";
  const messageId = typeof meta["messageId"] === "string" ? (meta["messageId"] as string) : null;
  const bodyText = plainText(text);
  const content = { bodyText, cta: { label: needsYesThread ? "Approve in Co-Work" : "Open in Co-Work", url: link } };
  const address = gatewayEmailAddress(gateway.token ?? "");
  await sendEmailViaResend({
    from: `Co-Work <${address}>`, to: gateway.address!, replyTo: address, subject: subject.slice(0, 200),
    html: renderEmailHtml({ businessName, ...branding }, content), text: renderEmailText({ businessName, ...branding }, content),
    ...(messageId ? { headers: { "In-Reply-To": messageId, References: messageId } } : {}),
  });
  return bodyText;
}

// ---------------------------------------------------------------- Telegram

export function telegramConfigured(): boolean {
  return Boolean(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_WEBHOOK_SECRET"]);
}

async function telegramApi(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual",
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: Record<string, unknown>; description?: string };
  if (!res.ok || !json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result ?? {};
}

async function telegramSend(chatId: string, text: string) {
  await telegramApi("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

async function telegramUsername(): Promise<string | null> {
  const fixed = process.env["TELEGRAM_BOT_USERNAME"]?.replace(/^@/, "");
  if (fixed) return fixed;
  const me = await telegramApi("getMe", {}).catch(() => null);
  return typeof me?.["username"] === "string" ? (me["username"] as string) : null;
}

/** Points the bot at our webhook (once; checked whenever someone connects). */
async function ensureTelegramWebhook() {
  const url = `${origin()}/api/public/telegram/webhook`;
  const info = await telegramApi("getWebhookInfo", {}).catch(() => null);
  if (info?.["url"] === url) return;
  await telegramApi("setWebhook", { url, secret_token: process.env["TELEGRAM_WEBHOOK_SECRET"], allowed_updates: ["message"], drop_pending_updates: true });
}

export { GATEWAY_LABEL };
