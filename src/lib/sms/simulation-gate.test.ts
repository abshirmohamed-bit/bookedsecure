import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveProviderName } from "./resolution";
import { getProvider } from "./provider.server";

describe("business-level simulation safety gate", () => {
  it("keeps a simulated business simulated regardless of the sender value", () => {
    expect(resolveEffectiveProviderName("simulated", "twilio")).toBe("simulated");
    expect(resolveEffectiveProviderName("simulated", "telnyx")).toBe("simulated");
    expect(resolveEffectiveProviderName("simulated", null)).toBe("simulated");
  });

  it("still lets the sender row own the carrier for live businesses", () => {
    expect(resolveEffectiveProviderName("twilio", "telnyx")).toBe("telnyx");
    expect(resolveEffectiveProviderName("telnyx", null)).toBe("telnyx");
    expect(resolveEffectiveProviderName(null, null)).toBe("simulated");
  });

  it("never makes an external provider call when resolved to simulated", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = getProvider(resolveEffectiveProviderName("simulated", "twilio"));
    expect(provider.name).toBe("simulated");
    const result = await provider.sendMessage({
      to: "+61400000000",
      body: "regression check",
      sender: { id: "sender-1", phone_number: "+61400000000", provider: "twilio" } as never,
    });
    expect(result).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
