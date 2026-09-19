import { describe, expect, it } from "vitest";
import {
  PRIMARY_TRADE_IDS,
  TRADE_IDS,
  TRADE_PRESETS,
  isTradeId,
  reserviceCycleLabel,
  reserviceWindowDays,
  resolveTrade,
  tradeLabel,
} from "@/lib/trades";

describe("trade presets", () => {
  it("offers five headline trades and keeps every preset complete", () => {
    expect(PRIMARY_TRADE_IDS).toHaveLength(5);
    for (const id of TRADE_IDS) {
      const preset = TRADE_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.label.length).toBeGreaterThan(3);
      expect(preset.serviceSeeds.length).toBeGreaterThan(0);
      expect(preset.reserviceDays.min).toBeLessThanOrEqual(preset.reserviceDays.max);
    }
  });

  it("never throws on an unknown or missing trade", () => {
    expect(resolveTrade(null)).toBeNull();
    expect(resolveTrade("plumbing")).toBeNull();
    expect(tradeLabel(undefined)).toBeNull();
    expect(isTradeId("lawn_garden")).toBe(true);
    expect(isTradeId("lawn")).toBe(false);
    expect(reserviceWindowDays(null)).toBeNull();
    expect(reserviceCycleLabel(null)).toBeNull();
  });

  it("uses the shorter summer cycle only where the trade has one", () => {
    const january = new Date("2026-01-15T00:00:00Z");
    const july = new Date("2026-07-15T00:00:00Z");
    expect(reserviceWindowDays("lawn_garden", january)).toEqual({ min: 14, max: 28 });
    expect(reserviceWindowDays("lawn_garden", july)).toEqual({ min: 42, max: 56 });
    expect(reserviceWindowDays("pool_servicing", january)).toEqual({ min: 28, max: 28 });
  });

  it("describes the cycle in weeks", () => {
    expect(reserviceCycleLabel("auto_marine_detailing")).toBe("every 4–6 weeks");
    expect(reserviceCycleLabel("pool_servicing")).toBe("every 4 weeks");
  });
});
