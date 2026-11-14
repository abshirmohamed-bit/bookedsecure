import { describe, expect, it } from "vitest";
import { isoWeek, readProxyHealth, upgradeAlertKey, upgradeReasons, type ProxyHealth } from "@/lib/engine-proxy";

const calm: ProxyHealth = {
  days: 7, proxy_mode: "sticky", bot_check_failures: 0, proxy_speed_mb_s: 1.1, speed_samples: 5,
  long_links_clipped: 4, proxy_tries: 30, proxy_refusals: 1, proxy_bytes: 3_000_000_000, proxies: [],
};

describe("when to upgrade the YouTube proxy", () => {
  it("stays quiet on a good week", () => {
    expect(upgradeReasons(calm)).toEqual([]);
  });
  it("flags three bot-check failures", () => {
    expect(upgradeReasons({ ...calm, bot_check_failures: 2 })).toEqual([]);
    expect(upgradeReasons({ ...calm, bot_check_failures: 3 })[0]).toMatch(/3 YouTube imports or clip jobs failed on the bot check/);
  });
  it("flags a slow average, but not from a single download", () => {
    expect(upgradeReasons({ ...calm, proxy_speed_mb_s: 0.13, speed_samples: 1 })).toEqual([]);
    expect(upgradeReasons({ ...calm, proxy_speed_mb_s: 0.13, speed_samples: 4 })[0]).toMatch(/0\.13 MB\/s, under 0\.3 MB\/s/);
    expect(upgradeReasons({ ...calm, proxy_speed_mb_s: null, speed_samples: 0 })).toEqual([]);
  });
  it("flags twenty long links in a week", () => {
    expect(upgradeReasons({ ...calm, long_links_clipped: 19 })).toEqual([]);
    expect(upgradeReasons({ ...calm, long_links_clipped: 20 })).toHaveLength(1);
  });
  it("lists every reason that holds", () => {
    expect(upgradeReasons({ ...calm, bot_check_failures: 5, proxy_speed_mb_s: 0.1, long_links_clipped: 25 })).toHaveLength(3);
  });
});

describe("one reminder a week", () => {
  it("uses the ISO week, across a year end", () => {
    expect(isoWeek(new Date("2026-11-12T10:00:00Z"))).toBe("2026-W46");
    expect(isoWeek(new Date("2026-12-31T10:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2027-01-04T10:00:00Z"))).toBe("2027-W01");
  });
  it("gives the same key all week and a new one the next", () => {
    const mon = upgradeAlertKey("biz", new Date("2026-11-09T01:00:00Z"));
    const sun = upgradeAlertKey("biz", new Date("2026-11-15T22:00:00Z"));
    const next = upgradeAlertKey("biz", new Date("2026-11-16T01:00:00Z"));
    expect(mon).toBe(sun);
    expect(next).not.toBe(mon);
    expect(upgradeAlertKey("other", new Date("2026-11-09T01:00:00Z"))).not.toBe(mon);
  });
});

describe("reading the Engine's summary", () => {
  it("accepts the route's shape and refuses anything else", () => {
    expect(readProxyHealth({ ...calm })).toEqual(calm);
    expect(readProxyHealth({ proxy_mode: "sticky" })).toBeNull();
    expect(readProxyHealth(null)).toBeNull();
    expect(readProxyHealth({ ...calm, proxy_speed_mb_s: "fast", proxy_mode: "weird" })).toMatchObject({ proxy_speed_mb_s: null, proxy_mode: "other" });
  });
});

describe("the proxy pool", () => {
  const benched = { label: "isp-one.test:8000", state: "benched" as const, benchedUntil: "2026-11-15T02:00:00Z", reason: "refused by YouTube", speedMbS: 2, ok: 9, refused: 3 };
  it("asks for attention when every proxy is benched, not when one still works", () => {
    expect(upgradeReasons({ ...calm, proxies: [benched, { ...benched, label: "isp-two.test:8000", state: "ok", benchedUntil: null, reason: null }] })).toEqual([]);
    expect(upgradeReasons({ ...calm, proxies: [benched] })[0]).toContain("Every proxy (1) is benched");
  });
  it("reads each proxy's status from the Engine, never more than the label", () => {
    const h = readProxyHealth({ ...calm, proxies: [{ label: "isp-one.test:8000", state: "benched", benched_until: "2026-11-15T02:00:00Z", reason: "out of data", speed_mb_s: 1.5, ok: 2, refused: 1 }, { nope: 1 }] });
    expect(h?.proxies).toEqual([{ label: "isp-one.test:8000", state: "benched", benchedUntil: "2026-11-15T02:00:00Z", reason: "out of data", speedMbS: 1.5, ok: 2, refused: 1 }]);
  });
});
