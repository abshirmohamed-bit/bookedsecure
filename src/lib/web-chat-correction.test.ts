import { describe, expect, it } from "vitest";
import { applyAnswer, nextStep, promptFor, reviewMessage, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { detectCorrection } from "@/lib/web-chat-correction";

const tenant: WebChatTenant = {
  name: "Glocast Detailing",
  flexibleRequestsEnabled: true,
  services: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Full Interior Detail",
      description: "Deep interior clean",
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Exterior Detail",
      description: "Wash and protect",
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
  ],
};

function upToMobile(): WebChatCollected {
  return {
    service_id: tenant.services[0]!.id,
    service_name: tenant.services[0]!.name,
    vehicle_type: "Mazda 3",
    suburb: "Marrickville",
    service_address: "12 Smith St",
    concerns: "Swirls",
    name: "abshir",
  };
}

function allCollected(): WebChatCollected {
  return { ...upToMobile(), mobile_number: "+61447852565", email: null };
}

describe("mid-conversation corrections", () => {
  it("corrects the name while the mobile question is active, without mobile validation", () => {
    const collected = upToMobile();
    expect(nextStep(collected)).toBe("mobile");
    const result = detectCorrection(collected, "mobile", "Actually put it as Abshiro for my name", tenant);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.field).toBe("name");
    expect(result.collected.name).toBe("Abshiro");
    expect(result.message).toContain("updated your name to Abshiro");
    expect(result.message).not.toMatch(/Australian mobile/i);
    // Every other field survives, and the unanswered question is resumed.
    expect(result.collected.suburb).toBe("Marrickville");
    expect(nextStep(result.collected)).toBe("mobile");
  });

  it("accepts “Actually, my name is Abshiro” phrasing", () => {
    const result = detectCorrection(upToMobile(), "mobile", "Actually, my name is Abshiro", tenant);
    expect(result.kind === "applied" && result.collected.name).toBe("Abshiro");
  });

  it("corrects the mobile while another field is active", () => {
    const collected: WebChatCollected = { ...upToMobile(), mobile_number: "+61447852565" };
    const result = detectCorrection(collected, "email", "change my number to 0412 345 678", tenant);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.collected.mobile_number).toBe("+61412345678");
    expect(nextStep(result.collected)).toBe("email");
  });

  it("routes back to the mobile field when no new number is given", () => {
    const result = detectCorrection(allCollected(), "review", "that phone number is wrong", tenant);
    expect(result.kind).toBe("reask");
    if (result.kind !== "reask") return;
    expect(result.field).toBe("mobile");
    expect(result.collected.mobile_number).toBeNull();
    expect(nextStep(result.collected)).toBe("mobile");
    // The replacement is still validated as an Australian mobile.
    expect(applyAnswer(result.collected, "mobile", "Abshiro", tenant).ok).toBe(false);
    expect(applyAnswer(result.collected, "mobile", "0447 852 565", tenant).ok).toBe(true);
  });

  it("corrects the suburb", () => {
    const result = detectCorrection(upToMobile(), "mobile", "Change my suburb to Parramatta", tenant);
    expect(result.kind === "applied" && result.collected.suburb).toBe("Parramatta");
  });

  it("corrects the vehicle", () => {
    const result = detectCorrection(upToMobile(), "mobile", "I meant the car is a Toyota, not a Mazda", tenant);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.collected.vehicle_type).toMatch(/Toyota/i);
  });

  it("corrects the email", () => {
    const result = detectCorrection(allCollected(), "review", "use this email instead: sam@example.com", tenant);
    expect(result.kind === "applied" && result.collected.email).toBe("sam@example.com");
  });

  it("corrects the requested service", () => {
    const result = detectCorrection(allCollected(), "review", "actually change the service to Exterior Detail", tenant);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    // "Exterior Detail" is one of the tenant's approved services, so the
    // correction lands on that service rather than an owner-review request.
    expect(result.collected.service_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(result.collected.service_name).toBe("Exterior Detail");
    expect(result.collected.typed_request ?? null).toBeNull();
  });

  it("asks a clarification question when the correction is ambiguous", () => {
    const result = detectCorrection(allCollected(), "review", "actually change my name and my number", tenant);
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") return;
    expect(result.message).toMatch(/name/i);
    expect(result.message).toMatch(/mobile number/i);
  });

  it("rejects an invalid replacement mobile", () => {
    const result = detectCorrection(allCollected(), "review", "actually my number is 12345", tenant);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.message).toMatch(/Australian mobile number/i);
  });

  it("leaves an ordinary answer alone", () => {
    expect(detectCorrection(upToMobile(), "mobile", "0447 852 565", tenant).kind).toBe("none");
    expect(detectCorrection({}, "service", "Full Interior Detail", tenant).kind).toBe("none");
  });

  it("goes back to the most recent answer on request", () => {
    const result = detectCorrection(upToMobile(), "mobile", "go back to my previous answer", tenant);
    expect(result.kind).toBe("reask");
    if (result.kind !== "reask") return;
    expect(result.field).toBe("name");
  });
});

describe("final review step", () => {
  it("shows every captured field before consent", () => {
    const collected = allCollected();
    expect(nextStep(collected)).toBe("review");
    const text = promptFor("review", tenant, collected).text;
    for (const fragment of [
      "Full Interior Detail",
      "Mazda 3",
      "Marrickville",
      "Swirls",
      "abshir",
      "+61447852565",
      "Not provided",
      "tell me what to change",
    ]) {
      expect(text).toContain(fragment);
    }
    expect(reviewMessage(collected)).toBe(text);
  });

  it("allows a correction at the review step and then moves to consent", () => {
    const corrected = detectCorrection(allCollected(), "review", "actually my name is Abshiro", tenant);
    expect(corrected.kind).toBe("applied");
    if (corrected.kind !== "applied") return;
    expect(nextStep(corrected.collected)).toBe("review");
    const confirmed = applyAnswer(corrected.collected, "review", "that all looks right", tenant);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(nextStep(confirmed.collected)).toBe("consent");
    // The latest corrected value is what the lead will carry.
    expect(confirmed.collected.name).toBe("Abshiro");
    expect(promptFor("review", tenant, confirmed.collected).text).toContain("Abshiro");
  });

  it("asks what to change when the review reply is not a confirmation", () => {
    const result = applyAnswer(allCollected(), "review", "hmm", tenant);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/which detail/i);
  });
});
