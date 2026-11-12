/**
 * The weekly "time to upgrade the YouTube proxy" reminder for platform admins.
 *
 * The Engine's last-week numbers (GET /v1/proxy/health) are read only while
 * Fly says the Engine is already running, and with wake:false, so a sleeping
 * Engine is never woken (and billed) for this. When upgradeReasons() fires,
 * each platform admin's business gets one notification per ISO week through
 * push_owner_notification (idempotency key per week and business). Nothing
 * here changes the proxy. See docs/engine-proxy-upgrade.md.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { readEngineState } from "@/lib/engine-control.server";
import { engineClient, engineConfigured } from "@/lib/engine.server";
import { readProxyHealth, upgradeAlertKey, upgradeReasons, type ProxyHealth } from "@/lib/engine-proxy";

export const PROXY_ALERT_KIND = "engine_proxy_upgrade";

/** The Engine's numbers, or null when it is asleep, off or unreachable. */
export async function liveProxyHealth(): Promise<ProxyHealth | null> {
  if (!engineConfigured()) return null;
  const state = await readEngineState();
  if (state.state !== "on") return null;
  const r = await engineClient<unknown>("GET", "/v1/proxy/health", undefined, { timeoutMs: 8_000, wake: false });
  return r.ok ? readProxyHealth(r.data) : null;
}

/** The businesses of every platform admin: where the reminder goes. */
async function adminBusinesses(): Promise<string[]> {
  const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "platform_admin");
  const ids = (roles ?? []).map((r) => r.user_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: profiles } = await supabaseAdmin.from("profiles").select("business_id").in("id", ids);
  return [...new Set((profiles ?? []).map((p) => p.business_id).filter((b): b is string => Boolean(b)))];
}

/** From the follow-ups hook: alert platform admins, at most once a week, when it's time to upgrade. */
export async function checkProxyUpgrade(now = new Date()): Promise<{ checked: boolean; reasons: string[]; alerted: number }> {
  const health = await liveProxyHealth().catch(() => null);
  if (!health) return { checked: false, reasons: [], alerted: 0 };
  const reasons = upgradeReasons(health);
  if (!reasons.length) return { checked: true, reasons, alerted: 0 };
  const businesses = await adminBusinesses();
  let alerted = 0;
  for (const businessId of businesses) {
    const { error } = await supabaseAdmin.rpc("push_owner_notification", {
      _business_id: businessId, _lead_id: null as unknown as string, _kind: PROXY_ALERT_KIND,
      _title: "Time to upgrade the video Engine's YouTube proxy",
      _body: `${reasons.join(" ")} An ISP proxy plan is faster and more trusted; only the YTDLP_PROXY secret on Fly changes.`,
      _key: upgradeAlertKey(businessId, now),
      _metadata: { reasons, health, checked_at: now.toISOString() } as unknown as Json,
    });
    if (!error) alerted++;
  }
  return { checked: true, reasons, alerted };
}

export type ProxyUpgradeStatus = {
  source: "live" | "last_alert" | "none";
  reasons: string[];
  health: ProxyHealth | null;
  at: string | null;
};

/** For the control room: the live numbers if the Engine is awake, else the last reminder sent. */
export async function proxyUpgradeStatus(now = new Date()): Promise<ProxyUpgradeStatus> {
  const live = await liveProxyHealth().catch(() => null);
  if (live) return { source: "live", reasons: upgradeReasons(live), health: live, at: now.toISOString() };
  const { data } = await supabaseAdmin.from("notifications").select("metadata, created_at").eq("kind", PROXY_ALERT_KIND)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { source: "none", reasons: [], health: null, at: null };
  const meta = (data.metadata ?? {}) as { reasons?: unknown; health?: unknown };
  return {
    source: "last_alert",
    reasons: Array.isArray(meta.reasons) ? meta.reasons.filter((r): r is string => typeof r === "string") : [],
    health: readProxyHealth(meta.health),
    at: data.created_at,
  };
}
