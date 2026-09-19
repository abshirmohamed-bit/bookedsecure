import { describe, expect, it } from "vitest";
import { nextStep, type WebChatCollected } from "@/lib/web-chat";
import {
  LEFT_FOR_TEAM,
  advancePastRepeats,
  askCount,
  askHistoryForPrompt,
  escalatedAsk,
  letGo,
  recordAsk,
  shouldLetGo,
} from "@/lib/web-chat-repeat";

const base = (over: Partial<WebChatCollected> = {}): WebChatCollected =>
  ({
    service_id: "svc-1",
    service_name: "Full Detail",
    vehicle_type: "2019 Camry",
    suburb: "Auburn",
    name: "Sam",
    mobile_number: "+61412345678",
    ...over,
  }) as WebChatCollected;

describe("quote chat repeat guard", () => {
  it("counts each ask for a detail", () => {
    let state = base();
    expect(askCount(state, "concerns")).toBe(0);
    state = recordAsk(state, "concerns");
    state = recordAsk(state, "concerns");
    expect(askCount(state, "concerns")).toBe(2);
    expect(askCount(state, "vehicle")).toBe(0);
  });

  it("adds an example the second time a detail is asked", () => {
    expect(escalatedAsk("vehicle", "What's the vehicle?", 0)).toBe("What's the vehicle?");
    const again = escalatedAsk("vehicle", "What's the vehicle?", 1);
    expect(again).toContain("What's the vehicle?");
    expect(again).toContain("2019 Toyota Camry");
  });

  it("offers a way out on an optional detail", () => {
    expect(escalatedAsk("concerns", "Anything to focus on?", 1)).toContain("skip");
    expect(escalatedAsk("vehicle", "What's the vehicle?", 1)).not.toContain("skip");
  });

  it("lets an optional detail go after a fair chance", () => {
    let state = base();
    expect(shouldLetGo(state, "concerns")).toBe(false);
    state = recordAsk(recordAsk(state, "concerns"), "concerns");
    expect(shouldLetGo(state, "concerns")).toBe(true);
    expect(letGo(state, "concerns").concerns).toBe(LEFT_FOR_TEAM);
  });

  it("never lets a required detail go", () => {
    let state = base({ vehicle_type: null });
    state = recordAsk(recordAsk(recordAsk(state, "vehicle"), "vehicle"), "vehicle");
    expect(shouldLetGo(state, "vehicle")).toBe(false);
    const advanced = advancePastRepeats(state, nextStep);
    expect(advanced.step).toBe("vehicle");
    expect(advanced.letGoSteps).toEqual([]);
  });

  it("moves past an over-asked optional detail instead of asking again", () => {
    let state = base({ concerns: null, service_address: "12 Smith St" });
    const before = advancePastRepeats(state, nextStep);
    expect(before.step).toBe("concerns");
    state = recordAsk(recordAsk(recordAsk(state, "concerns"), "concerns"), "concerns");
    const after = advancePastRepeats(state, nextStep);
    expect(after.step).not.toBe("concerns");
    expect(after.letGoSteps).toEqual(["concerns"]);
    expect(after.collected.concerns).toBe(LEFT_FOR_TEAM);
  });

  it("tells the model which questions were already asked", () => {
    expect(askHistoryForPrompt(base())).toBe("(nothing asked yet)");
    expect(askHistoryForPrompt(recordAsk(base(), "suburb"))).toContain("suburb: asked 1x");
  });
});
