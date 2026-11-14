/**
 * When to move the video Engine's YouTube proxy from a residential plan to an
 * ISP plan (faster, more trusted addresses). Pure rules over the Engine's
 * GET /v1/proxy/health summary; nothing here changes the proxy. See
 * docs/engine-proxy-upgrade.md.
 */

/** The Engine's last-week summary, as GET /v1/proxy/health returns it. */
export type ProxyHealth = {
  days: number;
  proxy_mode: "sticky" | "rotating" | "other" | "none" | "direct";
  bot_check_failures: number;
  proxy_speed_mb_s: number | null;
  speed_samples: number;
  long_links_clipped: number;
  proxy_tries: number;
  proxy_refusals: number;
  proxy_bytes: number;
  /** Each proxy in the Engine's pool (engine/app/pipeline/proxy_pool.py), healthiest first; host:port only. */
  proxies: ProxyStatus[];
};

export type ProxyStatus = {
  label: string; state: "ok" | "benched"; benchedUntil: string | null; reason: string | null;
  speedMbS: number | null; ok: number; refused: number;
};

export const UPGRADE_RULES = {
  /** Link imports or clip jobs that failed on YouTube's bot check or a 403 refusal. */
  botCheckFailures: 3,
  /** Average proxy download speed, MB/s, below which downloads are too slow. */
  minSpeedMbS: 0.3,
  /** Timed downloads needed before the speed counts (one slow download isn't a trend). */
  minSpeedSamples: 2,
  /** Long links (10 min+) clipped in a week: when residential addresses start getting flagged. */
  longLinks: 20,
} as const;

/** Why it's time to upgrade, as plain sentences; empty when it isn't. */
export function upgradeReasons(h: ProxyHealth): string[] {
  const out: string[] = [];
  if (h.bot_check_failures >= UPGRADE_RULES.botCheckFailures) {
    out.push(`${h.bot_check_failures} YouTube imports or clip jobs failed on the bot check in the last ${h.days} days.`);
  }
  if (h.proxy_speed_mb_s !== null && h.speed_samples >= UPGRADE_RULES.minSpeedSamples && h.proxy_speed_mb_s < UPGRADE_RULES.minSpeedMbS) {
    out.push(`Downloads through the proxy averaged ${h.proxy_speed_mb_s.toFixed(2)} MB/s, under ${UPGRADE_RULES.minSpeedMbS} MB/s.`);
  }
  if (h.proxies.length && h.proxies.every((p) => p.state === "benched")) {
    out.push(`Every proxy (${h.proxies.length}) is benched for being refused or out of data, so YouTube downloads are only getting through on second tries.`);
  }
  if (h.long_links_clipped >= UPGRADE_RULES.longLinks) {
    out.push(`${h.long_links_clipped} long YouTube links were clipped in the last ${h.days} days, the volume that gets residential addresses flagged.`);
  }
  return out;
}

/** The ISO week of `date` (UTC), e.g. "2026-W46": one reminder per week. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The notification key: the same week never alerts the same business twice. */
export function upgradeAlertKey(businessId: string, date: Date): string {
  return `engine_proxy_upgrade:${isoWeek(date)}:${businessId}`;
}

/** Reads the route's JSON safely; null when it isn't a summary. */
export function readProxyHealth(raw: unknown): ProxyHealth | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof r["bot_check_failures"] !== "number") return null;
  const speed = r["proxy_speed_mb_s"];
  const mode = r["proxy_mode"];
  return {
    days: n(r["days"]) || 7,
    proxy_mode: (["sticky", "rotating", "other", "none", "direct"] as const).includes(mode as never) ? (mode as ProxyHealth["proxy_mode"]) : "other",
    bot_check_failures: n(r["bot_check_failures"]),
    proxy_speed_mb_s: typeof speed === "number" && Number.isFinite(speed) ? speed : null,
    speed_samples: n(r["speed_samples"]),
    long_links_clipped: n(r["long_links_clipped"]),
    proxy_tries: n(r["proxy_tries"]),
    proxy_refusals: n(r["proxy_refusals"]),
    proxy_bytes: n(r["proxy_bytes"]),
    proxies: (Array.isArray(r["proxies"]) ? r["proxies"] : []).flatMap((x): ProxyStatus[] => {
      if (!x || typeof x !== "object") return [];
      const p = x as Record<string, unknown>;
      if (typeof p["label"] !== "string") return [];
      const speed = p["speed_mb_s"];
      return [{
        label: p["label"].slice(0, 80), state: p["state"] === "benched" ? "benched" : "ok",
        benchedUntil: typeof p["benched_until"] === "string" ? p["benched_until"] : null,
        reason: typeof p["reason"] === "string" ? p["reason"].slice(0, 80) : null,
        speedMbS: typeof speed === "number" && Number.isFinite(speed) ? speed : null,
        ok: n(p["ok"]), refused: n(p["refused"]),
      }];
    }).slice(0, 20),
  };
}
