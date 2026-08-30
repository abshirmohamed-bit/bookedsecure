import { describe, expect, it } from "vitest";
import {
  ProtectedSenderFieldError,
  buildOwnerSenderPatch,
  type ExistingSender,
} from "./sender-settings";
import { resolveEffectiveProviderName } from "./sms/resolution";

const glocastTelnyx: ExistingSender = {
  id: "c0985af1-0eae-4f5f-a064-0265d4e54930",
  business_id: "11111111-1111-1111-1111-111111111111",
  phone_number: "+61468045220",
  provider: "telnyx",
  active: true,
  is_primary: true,
  label: "Glocast dedicated Telnyx number",
};

describe("owner sender save policy", () => {
  it("saving without a provider value preserves the existing provider", () => {
    const patch = buildOwnerSenderPatch(glocastTelnyx, {
      id: glocastTelnyx.id,
      label: "Glocast dedicated Telnyx number",
    });
    expect(patch).toEqual({ label: "Glocast dedicated Telnyx number" });
    expect(Object.keys(patch)).toEqual(["label"]);
    expect(glocastTelnyx.provider).toBe("telnyx");
  });

  it.each([
    ["provider", { provider: "twilio" }],
    ["business_id", { business_id: "22222222-2222-2222-2222-222222222222" }],
    ["active", { active: false }],
    ["is_primary", { is_primary: false }],
    ["phone_number", { phone_number: "+61400000000" }],
    ["messaging_profile_id", { messaging_profile_id: "mp_evil" }],
  ])("rejects an owner attempt to change %s", (_field, extra) => {
    expect(() =>
      buildOwnerSenderPatch(glocastTelnyx, { id: glocastTelnyx.id, label: "x", ...extra }),
    ).toThrow(ProtectedSenderFieldError);
  });

  it("rejects a sender id that is not the tenant-loaded row", () => {
    expect(() => buildOwnerSenderPatch(glocastTelnyx, { id: "other-id", label: "x" })).toThrow(
      /Sender not found/,
    );
  });
});

describe("outbound provider resolution stays Telnyx for Glocast", () => {
  it("resolves telnyx when the business default and sender are telnyx", () => {
    expect(resolveEffectiveProviderName("telnyx", "telnyx")).toBe("telnyx");
  });

  it("never silently becomes twilio when the sender provider is missing", () => {
    expect(resolveEffectiveProviderName("telnyx", null)).toBe("telnyx");
    expect(resolveEffectiveProviderName("telnyx", undefined)).toBe("telnyx");
  });

  it("keeps a simulated business simulated", () => {
    expect(resolveEffectiveProviderName("simulated", "telnyx")).toBe("simulated");
  });
});
