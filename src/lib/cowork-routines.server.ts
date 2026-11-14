/**
 * Co-Work routines and the channel watch (docs/cowork-routines.sql).
 *
 * The 10-minute follow-ups hook calls sweepRoutines: each due routine is
 * claimed (its next run moved on first, so two sweeps never run it twice),
 * run as the owner who set it up with only reading and preparing tools, and
 * its report saved to the routine's own Co-Work conversation, where any
 * Confirm cards wait. The owner hears about it in the bell (and by email
 * when they asked). The channel watch checks the business's own connected
 * YouTube channel and clips new long uploads, under the rights the owner
 * confirmed when they switched it on. Until the table exists nothing runs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { assistantTimeZone } from "@/lib/assistant-time";
import {
  describeSchedule, MAX_ROUTINES, nextRunAt, reportPreview, routineRequest, routineScheduleSchema, ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX,
  WATCH_EVERY_MS, WATCH_MIN_SECONDS, WATCH_PER_CHECK, type RoutineSchedule,
} from "@/lib/cowork-routines";
import { cleanLine } from "@/lib/cowork-memory";

const db = () => supabaseAdmin as unknown as SupabaseClient;
const missing = (code?: string) => code === "PGRST205" || code === "42P01" || code === "PGRST204";
export const ROUTINES_OFF = "Routines are waiting for a database update (docs/cowork-routines.sql).";
export const ROUTINE_KIND = "cowork_routine";

export type RoutineRow = {
  id: string; business_id: string; created_by: string; kind: "task" | "watch_channel"; name: string; prompt: string;
  schedule: RoutineSchedule | Record<string, never>; deliver_email: boolean; enabled: boolean; thread_id: string | null;
  state: Record<string, unknown>; next_run_at: string | null; last_run_at: string | null; running_since: string | null;
  last_status: "ok" | "failed" | "skipped" | null; last_result: string | null; runs: number; created_at: string;
};
const COLUMNS = "id, business_id, created_by, kind, name, prompt, schedule, deliver_email, enabled, thread_id, state, next_run_at, last_run_at, running_since, last_status, last_result, runs, created_at";

export type RoutineView = {
  id: string; kind: "task" | "watch_channel"; name: string; prompt: string; when: string; schedule: RoutineSchedule | null;
  enabled: boolean; deliverEmail: boolean; nextRunAt: string | null; lastRunAt: string | null; lastStatus: RoutineRow["last_status"];
  lastResult: string | null; runs: number; threadId: string | null;
};

function view(r: RoutineRow): RoutineView {
  const schedule = routineScheduleSchema.safeParse(r.schedule);
  return {
    id: r.id, kind: r.kind, name: r.name, prompt: r.prompt,
    when: r.kind === "watch_channel" ? "Checks your YouTube channel every hour" : schedule.success ? describeSchedule(schedule.data) : "No schedule",
    schedule: schedule.success ? schedule.data : null, enabled: r.enabled, deliverEmail: r.deliver_email, nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at, lastStatus: r.last_status, lastResult: r.last_result, runs: r.runs, threadId: r.thread_id,
  };
}

async function timeZoneOf(businessId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("businesses").select("timezone").eq("id", businessId).maybeSingle();
  return assistantTimeZone((data?.timezone as string | null) ?? null);
}

export async function listRoutines(businessId: string): Promise<{ setupMissing: boolean; routines: RoutineView[] }> {
  const { data, error } = await db().from("cowork_routines").select(COLUMNS).eq("business_id", businessId).order("created_at", { ascending: true });
  if (missing(error?.code)) return { setupMissing: true, routines: [] };
  if (error) throw new Error("Could not read routines.");
  return { setupMissing: false, routines: ((data ?? []) as RoutineRow[]).map(view) };
}

async function rowOf(businessId: string, id: string): Promise<RoutineRow> {
  const { data, error } = await db().from("cowork_routines").select(COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
  if (missing(error?.code)) throw new Error(ROUTINES_OFF);
  if (error || !data) throw new Error("That routine wasn't found.");
  return data as RoutineRow;
}

/** Sets up a routine. The schedule is in the business's own time zone. */
export async function createRoutine(input: { businessId: string; userId: string; name: string; prompt: string; schedule: RoutineSchedule; deliverEmail?: boolean }): Promise<RoutineView> {
  const name = cleanLine(input.name, ROUTINE_NAME_MAX);
  const prompt = input.prompt.replace(/\s+\n/g, "\n").trim().slice(0, ROUTINE_PROMPT_MAX);
  if (name.length < 2) throw new Error("Give the routine a short name.");
  if (prompt.length < 4) throw new Error("Say what the routine should do.");
  const schedule = routineScheduleSchema.parse(input.schedule);
  const existing = await listRoutines(input.businessId);
  if (existing.setupMissing) throw new Error(ROUTINES_OFF);
  if (existing.routines.filter((r) => r.kind === "task").length >= MAX_ROUTINES) throw new Error(`There are already ${MAX_ROUTINES} routines; remove one first.`);
  const next = nextRunAt(schedule, await timeZoneOf(input.businessId));
  if (!next) throw new Error("That schedule never comes round.");
  const { data, error } = await db().from("cowork_routines").insert({
    business_id: input.businessId, created_by: input.userId, kind: "task", name, prompt, schedule, deliver_email: Boolean(input.deliverEmail), next_run_at: next,
  }).select(COLUMNS).single();
  if (error || !data) throw new Error("That routine couldn't be saved.");
  return view(data as RoutineRow);
}

/** Changes a routine: wording, schedule, email, or pause and resume. */
export async function updateRoutine(input: { businessId: string; id: string; name?: string | undefined; prompt?: string | undefined; schedule?: RoutineSchedule | undefined; deliverEmail?: boolean | undefined; enabled?: boolean | undefined }): Promise<RoutineView> {
  const row = await rowOf(input.businessId, input.id);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = cleanLine(input.name, ROUTINE_NAME_MAX);
    if (name.length < 2) throw new Error("Give the routine a short name.");
    patch["name"] = name;
  }
  if (input.prompt !== undefined && row.kind === "task") {
    const prompt = input.prompt.trim().slice(0, ROUTINE_PROMPT_MAX);
    if (prompt.length < 4) throw new Error("Say what the routine should do.");
    patch["prompt"] = prompt;
  }
  if (input.deliverEmail !== undefined) patch["deliver_email"] = input.deliverEmail;
  const schedule = input.schedule ? routineScheduleSchema.parse(input.schedule) : null;
  if (schedule) patch["schedule"] = schedule;
  if (input.enabled !== undefined) patch["enabled"] = input.enabled;
  const enabled = input.enabled ?? row.enabled;
  if (enabled && (schedule || input.enabled === true) && row.kind === "task") {
    patch["next_run_at"] = nextRunAt(schedule ?? (row.schedule as RoutineSchedule), await timeZoneOf(input.businessId));
  }
  if (enabled && input.enabled === true && row.kind === "watch_channel") patch["next_run_at"] = new Date().toISOString();
  const { data, error } = await db().from("cowork_routines").update(patch).eq("business_id", input.businessId).eq("id", input.id).select(COLUMNS).single();
  if (error || !data) throw new Error("That routine couldn't be changed.");
  return view(data as RoutineRow);
}

export async function deleteRoutine(businessId: string, id: string) {
  const { error } = await db().from("cowork_routines").delete().eq("business_id", businessId).eq("id", id);
  if (error) throw new Error(missing(error.code) ? ROUTINES_OFF : "That routine couldn't be removed.");
}

/** Makes a routine due now, so the next sweep (within 10 minutes) runs it. */
export async function runRoutineSoon(businessId: string, id: string) {
  await rowOf(businessId, id);
  const { error } = await db().from("cowork_routines").update({ next_run_at: new Date().toISOString(), enabled: true }).eq("business_id", businessId).eq("id", id);
  if (error) throw new Error("That routine couldn't be started.");
}

/**
 * Switches the YouTube channel watch on or off. Switching it on needs the
 * owner's own confirmation that they own the channel's videos; new uploads
 * from that moment on are clipped with the given look.
 */
export async function setChannelWatch(input: { businessId: string; userId: string; enabled: boolean; rightsConfirmed?: boolean; options?: Record<string, unknown> }): Promise<RoutineView | null> {
  const existing = await listRoutines(input.businessId);
  if (existing.setupMissing) throw new Error(ROUTINES_OFF);
  const current = existing.routines.find((r) => r.kind === "watch_channel");
  if (!input.enabled) {
    if (current) await updateRoutine({ businessId: input.businessId, id: current.id, enabled: false });
    return current ? { ...current, enabled: false } : null;
  }
  if (input.rightsConfirmed !== true) throw new Error("Confirm that you own the videos on your channel (or have permission) first.");
  const { youTubeAccessToken } = await import("@/lib/youtube.server");
  await youTubeAccessToken(input.businessId); // throws a plain message when YouTube isn't connected
  const state = { since: new Date().toISOString(), seen: [] as string[], options: input.options ?? {}, rights_confirmed_by: input.userId, rights_confirmed_at: new Date().toISOString() };
  if (current) {
    const { data, error } = await db().from("cowork_routines").update({ enabled: true, state, created_by: input.userId, next_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("business_id", input.businessId).eq("id", current.id).select(COLUMNS).single();
    if (error || !data) throw new Error("The channel watch couldn't be switched on.");
    return view(data as RoutineRow);
  }
  const { data, error } = await db().from("cowork_routines").insert({
    business_id: input.businessId, created_by: input.userId, kind: "watch_channel", name: "Clip new YouTube uploads", prompt: "", schedule: {},
    state, next_run_at: new Date().toISOString(),
  }).select(COLUMNS).single();
  if (error || !data) throw new Error("The channel watch couldn't be switched on.");
  return view(data as RoutineRow);
}

/* ---------- Running ---------- */

/** Routines run per sweep: each is a full Co-Work turn, so the hook stays short. */
const RUNS_PER_SWEEP = 3;
/** A run that started this long ago and never finished is taken to have failed. */
const STALE_RUN_MS = 20 * 60_000;

/** Runs what is due. Never throws. */
export async function sweepRoutines(): Promise<{ ran: number; failed: number } | { skipped: string }> {
  const now = new Date();
  const { data, error } = await db().from("cowork_routines").select(COLUMNS).eq("enabled", true).lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true }).limit(20);
  if (missing(error?.code)) return { skipped: "routines table not applied" };
  if (error) return { skipped: error.message };
  let ran = 0, failed = 0;
  for (const row of (data ?? []) as RoutineRow[]) {
    if (ran >= RUNS_PER_SWEEP) break;
    if (row.running_since && now.getTime() - Date.parse(row.running_since) < STALE_RUN_MS) continue;
    const claimed = await claim(row, now);
    if (!claimed) continue;
    ran++;
    try {
      if (row.kind === "watch_channel") await runWatch(row);
      else await runTask(row);
    } catch (e) {
      failed++;
      await finish(row, "failed", e instanceof Error ? e.message : "The routine failed.");
    }
  }
  return { ran, failed };
}

/** Moves the routine's next run on before running it, so no other sweep picks it up. */
async function claim(row: RoutineRow, now: Date): Promise<boolean> {
  const next = row.kind === "watch_channel"
    ? new Date(now.getTime() + WATCH_EVERY_MS).toISOString()
    : nextRunAt(row.schedule as RoutineSchedule, await timeZoneOf(row.business_id), now);
  let q = db().from("cowork_routines").update({ next_run_at: next, running_since: now.toISOString(), last_run_at: now.toISOString() })
    .eq("id", row.id).eq("enabled", true);
  q = row.next_run_at ? q.eq("next_run_at", row.next_run_at) : q.is("next_run_at", null);
  const { data } = await q.select("id");
  return Boolean(data?.length);
}

async function finish(row: RoutineRow, status: "ok" | "failed" | "skipped", result: string, extra: Record<string, unknown> = {}) {
  await db().from("cowork_routines").update({
    running_since: null, last_status: status, last_result: result.slice(0, 4000), runs: row.runs + 1, updated_at: new Date().toISOString(), ...extra,
  }).eq("id", row.id);
}

/** Whether the person who set it up still works here (a removed team member's routine stops). */
async function stillMember(row: RoutineRow): Promise<boolean> {
  const { data } = await supabaseAdmin.from("profiles").select("id").eq("id", row.created_by).eq("business_id", row.business_id).eq("active", true).maybeSingle();
  return Boolean(data);
}

async function notify(row: RoutineRow, title: string, body: string, threadId: string | null) {
  await supabaseAdmin.rpc("push_owner_notification", {
    _business_id: row.business_id, _lead_id: null as unknown as string, _kind: ROUTINE_KIND,
    _title: title.slice(0, 120), _body: reportPreview(body),
    _key: `routine:${row.id}:${new Date().toISOString().slice(0, 16)}`,
    _metadata: { routine_id: row.id, ...(threadId ? { thread_id: threadId } : {}) } as unknown as Json,
  }).then(() => undefined, () => undefined);
}

async function runTask(row: RoutineRow) {
  if (!(await stillMember(row))) {
    await finish(row, "skipped", "The person who set this up no longer has access, so it was paused.", { enabled: false });
    return;
  }
  const { createAssistantThread, persistOwnerExchange, assertAssistantThread } = await import("@/lib/assistant-history.server");
  let threadId = row.thread_id;
  if (threadId) {
    try { await assertAssistantThread(row.business_id, threadId); } catch { threadId = null; }
  }
  if (!threadId) {
    const t = await createAssistantThread({ businessId: row.business_id, userId: row.created_by });
    threadId = t.id;
    await supabaseAdmin.from("assistant_threads").update({ title: `Routine: ${row.name}`.slice(0, 80) }).eq("id", threadId).eq("business_id", row.business_id);
  }
  const { runAssistantAgent } = await import("@/lib/assistant-agent.server");
  const result = await runAssistantAgent({
    client: supabaseAdmin as unknown as SupabaseClient<Database>,
    businessId: row.business_id, userId: row.created_by, role: "owner",
    question: routineRequest(row.name, row.prompt), routine: true,
  });
  const done = result.executed.length ? result.executed.join(" ") : null;
  await persistOwnerExchange({ businessId: row.business_id, threadId, question: `Routine: ${row.name}`, answer: result.answer, proposals: result.proposals, done });
  const waiting = result.proposals.length;
  const report = `${result.answer}${waiting ? `\n\n${waiting} item${waiting === 1 ? "" : "s"} waiting for your yes in Co-Work.` : ""}`;
  await finish(row, "ok", report, { thread_id: threadId });
  await notify(row, `${row.name}${waiting ? `: ${waiting} to approve` : ""}`, report, threadId);
  if (row.deliver_email) await emailReport(row, report, threadId).catch(() => undefined);
}

async function emailReport(row: RoutineRow, report: string, threadId: string) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.created_by);
  const to = data?.user?.email;
  if (!to) return;
  const { loadEmailBranding, sendEmailViaResend } = await import("@/lib/email-campaigns.server");
  const { renderEmailHtml, renderEmailText } = await import("@/lib/email-template");
  const { businessName, branding } = await loadEmailBranding(row.business_id);
  const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
  const content = { heading: row.name, bodyText: report, cta: { label: "Open in Co-Work", url: `${origin}/assistant/${threadId}` } };
  await sendEmailViaResend({
    from: `Co-Work <campaigns@bookedsecure.com>`, to, subject: `Co-Work: ${row.name}`.slice(0, 200),
    html: renderEmailHtml({ businessName, ...branding }, content), text: renderEmailText({ businessName, ...branding }, content),
  });
}

/** Checks the business's own channel for new long uploads and starts clipping them. */
async function runWatch(row: RoutineRow) {
  if (!(await stillMember(row))) {
    await finish(row, "skipped", "The person who switched this on no longer has access, so it was paused.", { enabled: false });
    return;
  }
  const state = row.state ?? {};
  const since = typeof state["since"] === "string" ? (state["since"] as string) : row.created_at;
  const seen = new Set(Array.isArray(state["seen"]) ? (state["seen"] as string[]) : []);
  const { channelInsights } = await import("@/lib/youtube-insights.server");
  const insights = await channelInsights(row.business_id);
  const fresh = insights.recent
    .filter((v) => v.publishedAt && v.publishedAt > since && !seen.has(v.id) && v.seconds >= WATCH_MIN_SECONDS)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    .slice(0, WATCH_PER_CHECK);
  if (!fresh.length) {
    await finish(row, "ok", row.last_result && row.last_status === "ok" ? row.last_result : "No new uploads yet.");
    return;
  }
  const { clipFromLink } = await import("@/lib/video-clips.server");
  const { readJobOptions } = await import("@/lib/video-clips");
  const defaults = readJobOptions(state["options"] ?? {});
  const options = Object.keys(defaults).length ? { defaults } : {};
  const started: string[] = [];
  for (const v of fresh) {
    try {
      await clipFromLink({ businessId: row.business_id, userId: row.created_by, url: v.url, name: v.title, options });
      started.push(v.title || "your new video");
    } catch {
      // Left unseen so the next check tries again.
      continue;
    }
    seen.add(v.id);
  }
  const result = started.length ? `Clipping ${started.map((t) => `"${t}"`).join(" and ")}. The clips appear in Studio in a few minutes.` : "New uploads were found but couldn't be started; trying again next hour.";
  await finish(row, started.length ? "ok" : "failed", result, { state: { ...state, seen: [...seen].slice(-200) } });
  if (started.length) await notify(row, "Clipping your new upload", result, null);
}
