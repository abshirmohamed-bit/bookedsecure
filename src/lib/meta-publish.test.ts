import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("./meta-direct.server", () => ({ loadMetaAccount: vi.fn(), describeGraphFailure: () => "failed" }));
vi.mock("./meta-oauth.server", () => ({ readMetaAppConfig: () => ({ version: "v21.0" }) }));

const { metaPostProblem, metaConfirmationCode } = await import("./meta-publish.server");

describe("Facebook and Instagram post rules", () => {
  it("needs a picture on Instagram and something to say on Facebook", () => {
    expect(metaPostProblem("instagram", "Caption", 0)).toMatch(/at least one picture/);
    expect(metaPostProblem("instagram", "", 1)).toBeNull();
    expect(metaPostProblem("facebook", "  ", 0)).toMatch(/Write something/);
    expect(metaPostProblem("facebook", "", 2)).toBeNull();
    expect(metaPostProblem("facebook", "Hi", 11)).toMatch(/up to 10/);
    expect(metaPostProblem("instagram", "x".repeat(2201), 1)).toMatch(/2200/);
  });

  it("ties the assistant confirmation to the exact platform, text and pictures", () => {
    const code = metaConfirmationCode("b1", "facebook", "Hello", []);
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    expect(metaConfirmationCode("b1", "facebook", " Hello ", [])).toBe(code);
    expect(metaConfirmationCode("b1", "instagram", "Hello", [])).not.toBe(code);
    expect(metaConfirmationCode("b1", "facebook", "Hello!", [])).not.toBe(code);
  });
});
