/**
 * NON-PRODUCTION CANARY: real Lovable AI extraction call against the exact
 * orchestration `maybeHandleIntake` uses (`resolveIntake`).
 *
 * Zero live side effects by construction: no lead writes, no conversation
 * writes, no SMS, no alerts, no bookings, no usage rows, no live tenant data.
 * The tenant below is a synthetic canary tenant.
 */

import { describe, expect, it } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { ANALYSIS_MODEL } from "@/lib/ai.server";
import { nextStep, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { outstandingFields, type IntakeTenant } from "@/lib/web-chat-intake";
import {
  WebChatAiExtractionSchema,
  buildAiExtractionPrompt,
  buildAiExtractionSystem,
  resolveIntake,
  type AiExtractionContext,
  type WebChatAiExtraction,
} from "@/lib/web-chat-ai-extraction";

const AUBURN =
  "auburn, and its in bad condition the carpet, i accidentally left the window open, and it needs a really clean up please, my name is abshir and my number is 0466907824";

const chatTenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  services: [
    { id: "svc-int", name: "Interior Detail", duration_minutes: 90 } as never,
    { id: "svc-ext", name: "Exterior Detail", duration_minutes: 60 } as never,
  ],
};

const intakeTenant: IntakeTenant = {
  timezone: "Australia/Sydney",
  services: [
    { id: "svc-int", name: "Interior Detail" },
    { id: "svc-ext", name: "Exterior Detail" },
  ],
  locations: ["Auburn", "Lidcombe", "Granville", "Parramatta"],
};

/** Real gateway call: identical model + structured output config to production,
 * minus the usage row write. Counts calls so duplicates are visible. */
let CALLS = 0;
const RESPONSES: { label: string; raw: unknown }[] = [];

async function realExtract(context: AiExtractionContext): Promise<WebChatAiExtraction | null> {
  CALLS += 1;
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const gateway = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    supportsStructuredOutputs: true,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const result = await generateText({
    model: gateway(ANALYSIS_MODEL),
    output: Output.object({ schema: WebChatAiExtractionSchema }),
    system: buildAiExtractionSystem(context),
    prompt: buildAiExtractionPrompt(context),
  });
  const raw = (result as unknown as { output?: unknown }).output;
  RESPONSES.push({ label: context.message.slice(0, 40), raw });
  const parsed = WebChatAiExtractionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function run(
  raw: string,
  collected: WebChatCollected,
  step: string,
  extract: (context: AiExtractionContext) => Promise<WebChatAiExtraction | null> = realExtract,
) {
  const before = CALLS;
  const resolved = await resolveIntake({
    raw,
    collected,
    chatTenant,
    intakeTenant,
    step,
    turns: [{ role: "assistant", body: "Which suburb are you in?" }],
    businessName: "Glocast",
    extract,
  });
  return { ...resolved, callsMade: CALLS - before };
}

describe("CANARY: real AI extraction through resolveIntake", () => {
  it("Auburn message: every stated field resolved, nothing invented", async () => {
    const result = await run(AUBURN, {}, "suburb");

    // eslint-disable-next-line no-console
    console.log(
      "AUBURN_AI_RESPONSE",
      JSON.stringify(RESPONSES[RESPONSES.length - 1]?.raw, null, 2),
    );
    // eslint-disable-next-line no-console
    console.log("AUBURN_COLLECTED", JSON.stringify(result.collected, null, 2));
    // eslint-disable-next-line no-console
    console.log("AUBURN_NEXT_STEP", nextStep(result.collected));
    // eslint-disable-next-line no-console
    console.log("AUBURN_OUTSTANDING", JSON.stringify(outstandingFields(result.collected)));

    expect(result.aiUsed).toBe(true);
    expect(result.callsMade).toBe(1);
    expect(result.collected.suburb).toBe("Auburn");
    expect((result.collected.concerns ?? "").toLowerCase()).toMatch(/bad|poor|dirty|condition/);
    expect((result.collected.concerns ?? "").toLowerCase()).toContain("carpet");
    expect((result.collected.concerns ?? "").toLowerCase()).toMatch(/window/);
    expect(result.collected.name).toBe("Abshir");
    expect(result.collected.mobile_number).toBe("+61466907824");
    expect(result.collected.service_id ?? result.collected.service_name ?? null).toBeNull();
    expect(result.collected.vehicle_type ?? null).toBeNull();
    // No raw sentence anywhere in a canonical field.
    for (const value of [
      result.collected.suburb,
      result.collected.name,
      result.collected.vehicle_type,
      result.collected.service_name,
    ]) {
      expect((value ?? "").length).toBeLessThan(40);
      expect(value ?? "").not.toContain("my number is");
    }
    // Next question asks only for service or vehicle.
    expect(["service", "vehicle"]).toContain(nextStep(result.collected));
    const outstanding = outstandingFields(result.collected);
    expect(outstanding).not.toContain("location");
    expect(outstanding).not.toContain("name");
    expect(outstanding).not.toContain("mobile");
    expect(outstanding).not.toContain("concerns");
  });

  it("one-word suburb answer stays on the deterministic path (no AI call)", async () => {
    const result = await run("Lidcombe", {}, "suburb");
    expect(result.callsMade).toBe(0);
    expect(result.aiUsed).toBe(false);
  });

  it("one-field answer only fills that field", async () => {
    const result = await run("a black Toyota Corolla sedan", { suburb: "Auburn" }, "vehicle");
    expect(result.collected.suburb).toBe("Auburn");
    expect((result.collected.vehicle_type ?? "").toLowerCase()).toContain("corolla");
    expect(result.collected.name ?? null).toBeNull();
  });

  it("multiple fields out of order all land", async () => {
    const result = await run(
      "my number is 0466 907 824, i'm in Granville, name's Sam, interior detail please",
      {},
      "suburb",
    );
    // eslint-disable-next-line no-console
    console.log("OUT_OF_ORDER", JSON.stringify(result.collected));
    expect(result.collected.mobile_number).toBe("+61466907824");
    expect(result.collected.suburb).toBe("Granville");
    expect(result.collected.name).toBe("Sam");
    expect(result.collected.service_name).toBe("Interior Detail");
  });

  it("correction to an existing suburb replaces it", async () => {
    const result = await run(
      "sorry i made a mistake, i'm actually in Parramatta not Auburn",
      { suburb: "Auburn", name: "Abshir" },
      "vehicle",
    );
    // eslint-disable-next-line no-console
    console.log("CORRECTION", JSON.stringify(result.collected), JSON.stringify(result.corrections));
    expect(result.collected.suburb).toBe("Parramatta");
    expect(result.collected.name).toBe("Abshir");
  });

  it("an ambiguous suburb is left unresolved", async () => {
    const result = await run(
      "somewhere out west, i'm not really sure which suburb it counts as",
      {},
      "suburb",
    );
    // eslint-disable-next-line no-console
    console.log("AMBIGUOUS", JSON.stringify(result.collected));
    expect(result.collected.suburb ?? null).toBeNull();
    expect(outstandingFields(result.collected)).toContain("location");
  });

  it("a malformed AI response contaminates nothing", async () => {
    const result = await run(
      AUBURN,
      {},
      "suburb",
      async () => ({ suburb: 42, corrections: "nope" }) as never,
    );
    expect(result.aiUsed).toBe(false);
    // The deterministic fallback still stores a CLEAN field value, never a sentence.
    expect(result.collected.name).toBe("Abshir");
    expect((result.collected.suburb ?? "").length).toBeLessThan(40);
    expect(result.collected.suburb ?? "").not.toContain("my number is");
  });

  it("a null / timed-out AI response falls back safely", async () => {
    const nullResult = await run(AUBURN, {}, "suburb", async () => null);
    expect(nullResult.aiUsed).toBe(false);
    expect(nullResult.collected.suburb ?? "").not.toContain("my number is");

    const timeout = await run(AUBURN, {}, "suburb", async () => {
      throw new Error("gateway timeout");
    });
    expect(timeout.aiUsed).toBe(false);
    expect(timeout.collected.suburb ?? "").not.toContain("my number is");
  });

  it("a message containing only a phone number fills only the mobile", async () => {
    const result = await run("0466 907 824", { suburb: "Auburn" }, "mobile");
    // eslint-disable-next-line no-console
    console.log("PHONE_ONLY", JSON.stringify(result.collected), result.callsMade);
    expect(result.collected.mobile_number).toBe("+61466907824");
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.name ?? null).toBeNull();
  });

  it("a long legitimate concerns description stays in concerns", async () => {
    const long =
      "the back seats have dog hair everywhere, there's dried mud in the footwells from a camping trip, and the boot smells because a milk bottle leaked in there last week";
    const result = await run(long, { suburb: "Auburn" }, "concerns");
    // eslint-disable-next-line no-console
    console.log("LONG_CONCERNS", JSON.stringify(result.collected));
    expect((result.collected.concerns ?? "").length).toBeGreaterThan(20);
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.name ?? null).toBeNull();
    expect((result.collected.vehicle_type ?? "").length).toBeLessThan(40);
  });

  it("total real AI calls stay within one per eligible message", () => {
    // eslint-disable-next-line no-console
    console.log("TOTAL_AI_CALLS", CALLS);
    expect(CALLS).toBeLessThanOrEqual(12);
  });
});
