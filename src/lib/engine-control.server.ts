/**
 * Watching and controlling the video Engine's Fly machine. Every business shares
 * this one Engine, so anyone may see whether it is on, but starting, stopping and
 * restarting it is limited to platform admins and ENGINE_CONTROL_EMAILS.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { engineClient, engineConfigured } from "@/lib/engine.server";
import { readEngineMachines, stopWouldInterrupt, type EngineReading, type FlyMachine } from "@/lib/engine-status";

const API = "https://api.machines.dev/v1";
const CACHE_MS = 15_000;
type Account = { queue?: { pending?: number; running?: number } };
let cached: { at: number; reading: EngineReading } | null = null;

const app = () => process.env["FLY_APP_NAME"] || "crayzmundo-engine";

async function fly(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env["FLY_API_TOKEN"];
  if (!token) throw new Error("Engine control isn't connected yet: FLY_API_TOKEN is missing.");
  const res = await fetch(`${API}/apps/${encodeURIComponent(app())}${path}`, {
    ...init,
    headers: { Authorization: token.startsWith("FlyV1 ") ? token : `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Fly answered ${res.status}.`);
  return body;
}

const machines = async () => (await fly("/machines")) as FlyMachine[];

export async function isEngineOperator(userId: string): Promise<boolean> {
  const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  if (role) return true;
  const allowed = (process.env["ENGINE_CONTROL_EMAILS"] ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return false;
  // The sign-in record, not the editable profile.
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return allowed.includes(data.user?.email?.toLowerCase() ?? "");
}

export async function readEngineState(): Promise<EngineReading> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.reading;
  let reading: EngineReading;
  if (!engineConfigured()) reading = { state: "off", label: "Off", detail: "The engine's secrets aren't set." };
  else {
    try { reading = readEngineMachines(await machines()); }
    catch (error) { reading = { state: "off", label: "Unknown", detail: error instanceof Error ? error.message : "Fly couldn't be reached." }; }
  }
  cached = { at: Date.now(), reading };
  return reading;
}

/** Only ever asked of a running Engine: any request wakes a sleeping one. */
async function workInProgress(): Promise<number> {
  const r = await engineClient<Account>("GET", "/v1/account", undefined, { timeoutMs: 8_000, wake: false });
  return r.ok ? stopWouldInterrupt(r.data.queue) : 0;
}

export type EngineAction = "start" | "stop" | "restart";

export async function controlEngine(action: EngineAction, force: boolean): Promise<{ ok: boolean; message: string }> {
  const list = await machines();
  const machine = list[0];
  if (!machine) return { ok: false, message: "There's no engine machine to control." };
  const running = machine.state === "started";
  if (action === "stop" && !running) return { ok: true, message: "The engine is already stopped." };
  if (action === "start" && running) return { ok: true, message: "The engine is already on." };
  if (action !== "start" && running && !force) {
    const busy = await workInProgress();
    if (busy > 0) return { ok: false, message: `The engine has ${busy} job${busy === 1 ? "" : "s"} in progress. Tell the owner what would be interrupted and only continue with force if they say yes.` };
  }
  // Restarting a stopped machine has nothing to restart, so it is a start.
  const verb = action === "restart" && !running ? "start" : action;
  await fly(`/machines/${encodeURIComponent(machine.id)}/${verb}`, { method: "POST" });
  cached = null;
  return { ok: true, message: verb === "stop" ? "The engine is stopping." : verb === "restart" ? "The engine is restarting." : "The engine is starting." };
}
