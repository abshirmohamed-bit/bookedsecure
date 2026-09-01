// Structured AI analysis: contract, safe normalisation, redacted failure
// reporting, and the single bounded repair retry. No provider calls, no DB
// writes, no SMS.
import { describe, expect, it, vi } from "vitest";
import {
  AI_ANALYSIS_FAILURE_MESSAGE,
  AnalysisSchema,
  buildRepairInstruction,
  correlationRef,
  failureMessage,
  parseAnalysisPayload,
  stripJsonFences,
} from "@/lib/ai-analysis-contract";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: async () => ({ data: null, error: null }) }) },
}));

const valid = {
  summary: "Customer wants an interior detail on a sedan.",
  readiness: "needs_information",
  missing_fields: ["main_concerns"],
  extracted: {
    vehicle_type: "Sedan",
    suburb: "Marsden Park",
    last_cleaned_at: null,
    main_concerns: null,
    service_intent: "interior detail",
    requested_day_or_time: "weekend mornings",
  },
  suggested_reply: "Thanks for the details, the owner will confirm the right option.",
  needs_human_review: true,
};

describe("analysis contract", () => {
  it("accepts a valid structured response", () => {
    const result = parseAnalysisPayload(JSON.stringify(valid));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.analysis.extracted.requested_day_or_time).toBe("weekend mornings");
    }
  });

  it("keeps requested_day_or_time required-but-nullable (never omitted)", () => {
    const { requested_day_or_time: _omit, ...rest } = valid.extracted;
    const missing = parseAnalysisPayload(JSON.stringify({ ...valid, extracted: rest }));
    expect(missing.status).toBe("invalid");

    const nulled = parseAnalysisPayload(
      JSON.stringify({ ...valid, extracted: { ...valid.extracted, requested_day_or_time: null } }),
    );
    expect(nulled.status).toBe("ok");
  });

  it("reports a missing required field safely", () => {
    const { summary: _drop, ...rest } = valid;
    const result = parseAnalysisPayload(JSON.stringify(rest));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toContain("summary");
      expect(result.reason).toContain("schema_rejected");
      expect(result.reason).not.toContain("Marsden Park");
    }
  });

  it("reports null where a string is expected safely", () => {
    const result = parseAnalysisPayload(JSON.stringify({ ...valid, summary: null }));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.reason).toContain("summary");
  });

  it("reports a wrong type safely", () => {
    const result = parseAnalysisPayload(
      JSON.stringify({ ...valid, missing_fields: "main_concerns", needs_human_review: "yes" }),
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toContain("missing_fields");
      expect(result.reason).not.toContain("Sedan");
    }
  });

  it("rejects an unknown readiness value rather than accepting arbitrary JSON", () => {
    expect(parseAnalysisPayload(JSON.stringify({ ...valid, readiness: "Inquiring" })).status).toBe(
      "invalid",
    );
    expect(parseAnalysisPayload(JSON.stringify({ customer_name: "Usamah" })).status).toBe("invalid");
  });

  it("handles Markdown-fenced valid JSON", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(stripJsonFences(fenced)).toBe(JSON.stringify(valid));
    expect(parseAnalysisPayload(fenced).status).toBe("ok");
  });

  it("distinguishes an empty or unparseable provider response", () => {
    expect(parseAnalysisPayload("").status).toBe("unparseable");
    expect(parseAnalysisPayload(undefined).status).toBe("unparseable");
    expect(parseAnalysisPayload("sorry, I cannot help").status).toBe("unparseable");
    expect(parseAnalysisPayload("[1,2]").status).toBe("unparseable");
  });

  it("builds a repair instruction with exact types and no secrets", () => {
    const instruction = buildRepairInstruction("schema_rejected: summary: expected string");
    expect(instruction).toContain("requested_day_or_time");
    expect(instruction).toContain("boolean");
    expect(instruction).not.toMatch(/api[_-]?key/i);
  });

  it("formats an owner-facing failure message with a correlation reference", () => {
    const id = "6f1a2b3c-4d5e-6f70-8901-234567890abc";
    const message = failureMessage("schema_rejected: summary: expected string", id);
    expect(message).toContain(AI_ANALYSIS_FAILURE_MESSAGE);
    expect(message).toContain(correlationRef(id));
    expect(correlationRef(id)).toBe("6F1A2B3C");
  });
});

describe("bounded retry", () => {
  async function load() {
    return await import("@/lib/ai.server");
  }

  it("returns the first valid response without retrying", async () => {
    const { runStructuredAnalysis } = await load();
    const generate = vi.fn(async () => ({
      output: AnalysisSchema.parse(valid),
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const result = await runStructuredAnalysis({ system: "s", prompt: "p", generate });
    expect(result.attempts).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.inputTokens).toBe(10);
  });

  it("succeeds on exactly one repair retry", async () => {
    const { runStructuredAnalysis } = await load();
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ customer_name: "Usamah" }) })
      .mockResolvedValueOnce({ text: "```json\n" + JSON.stringify(valid) + "\n```" });
    const result = await runStructuredAnalysis({ system: "s", prompt: "p", generate });
    expect(result.attempts).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
    const second = generate.mock.calls[1]![0] as { system: string; prompt: string };
    expect(second.system).toBe("s");
    expect(second.prompt).toContain("Return ONE JSON object only");
  });

  it("escalates after one failed retry without looping", async () => {
    const { runStructuredAnalysis, AnalysisFailure } = await load();
    const generate = vi.fn(async () => ({ text: "not json at all" }));
    await expect(
      runStructuredAnalysis({ system: "s", prompt: "p", generate }),
    ).rejects.toBeInstanceOf(AnalysisFailure);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("escalates an empty provider response", async () => {
    const { runStructuredAnalysis } = await load();
    const generate = vi.fn(async () => ({ text: "" }));
    await expect(runStructuredAnalysis({ system: "s", prompt: "p", generate })).rejects.toThrow(
      /empty_response|unparseable_response/,
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transport/provider error", async () => {
    const { runStructuredAnalysis } = await load();
    const generate = vi.fn(async () => {
      throw new TypeError("network down");
    });
    await expect(runStructuredAnalysis({ system: "s", prompt: "p", generate })).rejects.toThrow(
      /provider_error/,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("failure handling side effects", () => {
  it("writes one audit event and one de-duplicated owner alert, and nothing else", async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const notifications: string[] = [];
    vi.doMock("@/lib/jobs.server", () => ({
      createNotification: async (input: { idempotencyKey: string }) => {
        if (notifications.includes(input.idempotencyKey)) return { created: false };
        notifications.push(input.idempotencyKey);
        return { created: true, id: "n1" };
      },
    }));
    const { recordAnalysisFailure } = await import("@/lib/ai.server");
    const client = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { data: null, error: null };
        },
      }),
    } as never;

    const args = {
      businessId: "b1",
      leadId: "l1",
      correlationId: "6f1a2b3c-4d5e-6f70-8901-234567890abc",
      reason: "schema_rejected: summary: expected string",
      attempts: 2,
      client,
    };
    await recordAnalysisFailure(args);
    await recordAnalysisFailure(args); // replay

    expect(inserts.every((entry) => entry.table === "audit_events")).toBe(true);
    expect(notifications).toHaveLength(1);
    // No lead status, booking, job, usage, SMS or follow-up writes.
    const touched = new Set(inserts.map((entry) => entry.table));
    for (const forbidden of ["leads", "messages", "jobs", "automation_jobs", "booking_offers", "ai_outputs"]) {
      expect(touched.has(forbidden)).toBe(false);
    }
    expect(inserts[0]!.row["event_type"]).toBe("ai_analysis_failed");
    vi.doUnmock("@/lib/jobs.server");
  });
});
