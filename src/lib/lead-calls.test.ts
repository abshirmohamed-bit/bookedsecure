import { describe, expect, it } from "vitest";
import { callLength, captureLabels, editedKeys, parseTranscript, readCaptured, transcriptText } from "@/lib/lead-calls";

describe("reading a pasted call", () => {
  it("tells the business side from the customer and keeps notes", () => {
    const lines = parseTranscript("Me: Hi, it's about your quote.\nSarah: Yes! I've got a BMW X5.\nit needs a full interior\n- wants Friday 10am\n[00:42] Agent: Friday works.", "Shine Co");
    expect(lines.map((l) => l.role)).toEqual(["agent", "prospect", "note", "agent"]);
    expect(lines[1]!.text).toBe("Yes! I've got a BMW X5. it needs a full interior");
    expect(lines[2]!.text).toBe("wants Friday 10am");
    expect(transcriptText(lines)).toContain("Customer: Yes!");
  });
  it("recognises the business by its own name", () => {
    expect(parseTranscript("Shine Co: Hello\nCustomer: Hi", "Shine Co").map((l) => l.role)).toEqual(["agent", "prospect"]);
  });
});

describe("captured values", () => {
  it("keeps only real lead fields, a valid mobile and email, and a known readiness", () => {
    const out = readCaptured({ name: " Sarah Jenkins ", mobile_number: "0412 345 678", email: "nope", readiness_classification: "high_intent",
      vehicle_type: "2022 BMW X5", lead_score: 99, preferred_time: "Friday 10am", suburb: null });
    expect(out).toEqual({ name: "Sarah Jenkins", mobile_number: "+61412345678", readiness_classification: "high_intent", vehicle_type: "2022 BMW X5", preferred_time: "Friday 10am" });
    expect(readCaptured({ readiness_classification: "super_hot", mobile_number: "555-019-2834" })).toEqual({});
  });
  it("names the subject for the business and spots edits", () => {
    expect(captureLabels("Pool").vehicle_type).toBe("Pool");
    expect(editedKeys({ name: "Sarah" }, { name: "Sara", suburb: "Ryde" })).toEqual(["name", "suburb"]);
    expect(callLength(185)).toBe("3 min 05 s");
    expect(callLength(null)).toBe("");
  });
});
