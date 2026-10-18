/**
 * The one AI brain.
 *
 * Both the owner assistant ("Cowork") and the public quote-page assistant run
 * through this single agent loop: same provider, same model, same tool-calling
 * runtime. Only the system prompt and the tool set differ, and those are always
 * built server-side from the tenant's own records.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";
import { withAiBackup } from './tenant-ai.server';
import { createLovableAiGatewayRunIdFetch } from './ai-run-id.server';

/** Shared model for every agent surface. */
export const AGENT_MODEL = "openai/gpt-6-astra";

export function agentProvider(apiKey: string) {
  return createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    // Satisfies the SDK; the gateway authenticates on the header below.
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: createLovableAiGatewayRunIdFetch().fetch,
  });
}

export type AgentRunInput = {
  businessId: string;
  apiKey: string;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  /** Reasoning depth. Customer-facing turns stay light; owner work can go deeper. */
  effort?: "low" | "medium" | "high";
  maxSteps?: number;
};

/**
 * Runs one agent turn to completion and returns its final text.
 *
 * The call always streams so a longer tool run is never cut off by a request
 * timeout, and the stream is consumed here because callers answer in one shot.
 */
export async function runAgentTurn(input: AgentRunInput): Promise<string> {
  let toolsStarted = false;
  return withAiBackup({
    businessId: input.businessId,
    canReplay: () => !toolsStarted,
    gateway: () => runGatewayTurn(input, () => { toolsStarted = true; }),
    backup: async (provider) => {
      let failure: unknown;
      const result = streamText({
        ...provider, system: input.system, messages: input.messages, tools: input.tools,
        stopWhen: stepCountIs(input.maxSteps ?? 50), maxRetries: 0,
        onError: ({ error }) => { failure = error; },
      });
      const text = await result.text;
      if (failure) throw failure;
      return text.trim();
    },
  });
}

async function runGatewayTurn(input: AgentRunInput, toolsStarted: () => void): Promise<string> {
  const provider = agentProvider(input.apiKey);
  let streamError: unknown = null;
  const result = streamText({
    model: provider.responses(AGENT_MODEL),
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    onChunk: ({ chunk }) => { if (chunk.type === 'tool-call' || chunk.type === 'tool-input-start') toolsStarted(); },
    stopWhen: stepCountIs(input.maxSteps ?? 50),
    onError: ({ error }) => {
      // Provider failures (e.g. a 402 from the gateway) surface here first;
      // keep the real error so callers can tell billing apart from a bad turn.
      streamError ??= error;
    },
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: input.effort ?? "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  try {
    const text = (await result.text).trim();
    if (streamError) throw streamError;
    return text;
  } catch (error) {
    throw streamError ?? error;
  }
}
