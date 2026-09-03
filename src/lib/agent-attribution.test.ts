import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  attributionAuthorisesSend,
  attributionFromJobRow,
  jobAttributionColumns,
  messageAttributionColumns,
  normaliseAgentAttribution,
} from "./agent-attribution";
import { deriveMessageSource } from "./lead-engine.server";

const engineSource = readFileSync("src/lib/lead-engine.server.ts", "utf8");
const jobsSource = readFileSync("src/lib/jobs.server.ts", "utf8");
const attributionSource = readFileSync("src/lib/agent-attribution.ts", "utf8");

describe("attribution is optional and additive", () => {
  it("treats absent attribution as valid and empty", () => {
    for (const input of [undefined, null, {}]) {
      const result = normaliseAgentAttribution(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.attribution.present).toBe(false);
      expect(messageAttributionColumns(result.attribution)).toEqual({
        sequence_id: null,
        agent_action_id: null,
        template_id: null,
      });
      expect(jobAttributionColumns(result.attribution)).toEqual({
        sequence_id: null,
        agent_action_id: null,
        sequence_step_template_id: null,
      });
    }
  });

  it("stores attribution only when explicitly provided", () => {
    const result = normaliseAgentAttribution({
      sequenceId: "contact_only_introduction",
      actionKind: "send_sms",
      agentActionId: "11111111-2222-3333-4444-555555555555",
      templateId: "intro_step_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attribution.present).toBe(true);
    expect(messageAttributionColumns(result.attribution)).toEqual({
      sequence_id: "contact_only_introduction",
      agent_action_id: "11111111-2222-3333-4444-555555555555",
      template_id: "intro_step_1",
    });
    expect(jobAttributionColumns(result.attribution)).toEqual({
      sequence_id: "contact_only_introduction",
      agent_action_id: "11111111-2222-3333-4444-555555555555",
      sequence_step_template_id: "intro_step_1",
    });
  });

  it("trims whitespace but rejects blank strings", () => {
    const trimmed = normaliseAgentAttribution({ sequenceId: "  seq_a  " });
    expect(trimmed.ok && trimmed.attribution.sequenceId).toBe("seq_a");
    expect(normaliseAgentAttribution({ sequenceId: "   " }).ok).toBe(false);
    expect(normaliseAgentAttribution({ templateId: "" }).ok).toBe(false);
  });

  it("rejects missing or invalid agent action references safely", () => {
    for (const bad of ["not-a-uuid", "1234", "11111111-2222-3333-4444-5555555555", " "]) {
      const result = normaliseAgentAttribution({ agentActionId: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/agent action reference/i);
    }
  });

  it("rejects unknown action kinds", () => {
    expect(normaliseAgentAttribution({ actionKind: "book_job" }).ok).toBe(false);
    for (const kind of ["send_sms", "capture_consent", "handoff", "none_no_outbound"]) {
      expect(normaliseAgentAttribution({ actionKind: kind }).ok).toBe(true);
    }
  });

  it("maps a job row back to the same attribution values (passthrough)", () => {
    expect(
      attributionFromJobRow({
        sequence_id: "seq_a",
        agent_action_id: "11111111-2222-3333-4444-555555555555",
        sequence_step_template_id: "tpl_1",
      }),
    ).toEqual({
      sequenceId: "seq_a",
      agentActionId: "11111111-2222-3333-4444-555555555555",
      templateId: "tpl_1",
    });
    expect(attributionFromJobRow({})).toEqual({
      sequenceId: null,
      agentActionId: null,
      templateId: null,
    });
  });
});

describe("message source semantics are unchanged for non-agent callers", () => {
  it("never derives agent_sequence", () => {
    const kinds = ["acknowledgement", "follow_up", "manual", "approved_reply"] as const;
    const origins = [null, undefined, "live", "imported", "manual"];
    for (const kind of kinds) {
      for (const origin of origins) {
        expect(deriveMessageSource(kind, origin)).not.toBe("agent_sequence");
      }
    }
  });

  it("keeps every existing mapping byte-for-byte", () => {
    expect(deriveMessageSource("manual", "live")).toBe("manual");
    expect(deriveMessageSource("approved_reply", "imported")).toBe("approved_reply");
    expect(deriveMessageSource("follow_up", "live")).toBe("automation");
    expect(deriveMessageSource("acknowledgement", null)).toBe("quote_page");
    expect(deriveMessageSource("acknowledgement", undefined)).toBe("quote_page");
    expect(deriveMessageSource("acknowledgement", "live")).toBe("quote_page");
    expect(deriveMessageSource("acknowledgement", "imported")).toBe("inbound_enquiry");
  });

  it("only an explicit caller value can produce agent_sequence", () => {
    expect(engineSource).toMatch(/input\.source \?\? deriveMessageSource/);
    // No code path assigns the agent source implicitly.
    expect(engineSource).not.toMatch(/messageSource\s*=\s*"agent_sequence"/);
    expect(engineSource.match(/"agent_sequence"/g) ?? []).toHaveLength(1);
  });
});

describe("step 2 cannot activate the Phase 4 executor", () => {
  it("attribution never authorises a send", () => {
    expect(attributionAuthorisesSend()).toBe(false);
  });

  it("the attribution module is pure: no I/O, no provider, no ledger writes", () => {
    for (const forbidden of [
      "supabaseAdmin",
      "supabase",
      "fetch(",
      "sendSms",
      "enqueueJob",
      "createNotification",
      "commit_web_chat_booking",
      "current_sequence",
      "agent_actions",
      "sequence_campaigns",
      "import(",
    ]) {
      expect(attributionSource).not.toContain(forbidden);
    }
  });

  it("neither changed file imports an executor or activation path", () => {
    for (const source of [engineSource, jobsSource]) {
      expect(source).not.toMatch(/agent-executor|sequence-execut|executeSequence|runAgentAction/);
      expect(source).not.toMatch(/mode:\s*"live"/);
      expect(source).not.toMatch(/execution_authorised|agent_execution_opted_in/);
      expect(source).not.toContain("current_sequence");
      expect(source).not.toContain("sequence_campaigns");
    }
  });

  it("attribution validation runs before the carrier is reached", () => {
    const validateAt = engineSource.indexOf("normaliseAgentAttribution(input)");
    const providerAt = engineSource.indexOf("provider.sendMessage");
    expect(validateAt).toBeGreaterThan(-1);
    expect(providerAt).toBeGreaterThan(validateAt);
  });

  it("a supplied agent action reference is tenant-scoped", () => {
    const block = engineSource.slice(
      engineSource.indexOf("if (attribution.agentActionId)"),
      engineSource.indexOf("const automated ="),
    );
    expect(block).toContain('.from("agent_actions")');
    expect(block).toContain('.eq("business_id", input.businessId)');
    expect(block).not.toContain("insert");
    expect(block).not.toContain("update");
  });

  it("the job path only passes attribution through — it enqueues nothing new", () => {
    expect(jobsSource).toContain("...attributionFromJobRow(job)");
    // Exactly the historical enqueue/notification surface, no additions.
    expect(jobsSource.match(/from\("automation_jobs"\)\s*\.insert/g) ?? []).toHaveLength(1);
    expect(jobsSource.match(/from\("notifications"\)\s*\.insert/g) ?? []).toHaveLength(1);
  });
});
