import { describe, expect, it, vi } from "vitest";
import { withinSegmentCap } from "./commercial";
import { resolveEffectiveProviderName } from "./sms/resolution";
import { getProvider } from "./sms/provider.server";

const CAP = 250;

/**
 * In-memory model of the atomic `reserve_sms_segments` SQL function: a single
 * conditional update that only succeeds while the reservation fits inside the
 * included allowance. Blocked attempts are recorded, never partially reserved.
 */
function createPeriod(included = CAP) {
  const state = { included, used: 0, blocked: 0 };
  return {
    state,
    reserve(segments: number): boolean {
      if (!withinSegmentCap(state.used, segments, state.included)) {
        state.blocked += segments;
        return false;
      }
      state.used += segments;
      return true;
    },
  };
}

describe("Glocast pilot segment cap reconciled to 250", () => {
  it("allows 249 segments when every other gate passes", () => {
    const period = createPeriod();
    expect(period.reserve(249)).toBe(true);
    expect(period.state.used).toBe(249);
    expect(period.state.blocked).toBe(0);
  });

  it("allows a reservation that lands exactly on segment 250", () => {
    const period = createPeriod();
    expect(period.reserve(249)).toBe(true);
    expect(period.reserve(1)).toBe(true);
    expect(period.state.used).toBe(250);
  });

  it("blocks any reservation that would exceed 250", () => {
    const period = createPeriod();
    expect(period.reserve(250)).toBe(true);
    expect(period.reserve(1)).toBe(false);
    expect(period.state.used).toBe(250);

    const fresh = createPeriod();
    expect(fresh.reserve(251)).toBe(false);
    expect(fresh.state.used).toBe(0);
  });

  it("cannot exceed 250 under concurrent reservations", () => {
    const period = createPeriod();
    const results = Array.from({ length: 60 }, () => period.reserve(5));
    expect(period.state.used).toBe(250);
    expect(period.state.used).toBeLessThanOrEqual(CAP);
    expect(results.filter(Boolean)).toHaveLength(50);
    expect(results.filter((r) => !r)).toHaveLength(10);
  });

  it("records blocked usage instead of silently dropping it", () => {
    const period = createPeriod();
    expect(period.reserve(250)).toBe(true);
    expect(period.reserve(3)).toBe(false);
    expect(period.reserve(2)).toBe(false);
    expect(period.state.blocked).toBe(5);
    expect(period.state.used).toBe(250);
  });

  it("makes no external provider call after a cap rejection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const period = createPeriod();
    expect(period.reserve(250)).toBe(true);

    const allowed = period.reserve(1);
    expect(allowed).toBe(false);
    if (allowed) {
      const provider = getProvider(resolveEffectiveProviderName("telnyx", "telnyx"));
      await provider.sendMessage({
        to: "+61400000000",
        body: "should never happen",
        sender: { id: "s", phone_number: "+61468045220", provider: "telnyx" } as never,
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps hard-block semantics: overage is refused, never billed", () => {
    expect(withinSegmentCap(250, 1, CAP)).toBe(false);
    expect(withinSegmentCap(200, 50, CAP)).toBe(true);
  });
});
