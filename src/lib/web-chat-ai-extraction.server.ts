/**
 * The single model call used by the public quote conversation.
 *
 * It ONLY reads: one customer message plus the recent turns and the current
 * canonical state, and returns candidate field values. It never writes state,
 * never books, never messages and never touches a provider. Any failure
 * (missing key, cap, provider error, invalid JSON, schema mismatch) resolves to
 * null so the deterministic regex path continues unchanged.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { ANALYSIS_MODEL } from "@/lib/ai.server";
import {
  WebChatAiExtractionParseSchema,
  WebChatAiExtractionSchema,
  buildAiExtractionPrompt,
  buildAiExtractionSystem,
  type AiExtractionContext,
  type WebChatAiExtraction,
} from "@/lib/web-chat-ai-extraction";

export type AiExtractor = (context: AiExtractionContext) => Promise<WebChatAiExtraction | null>;

function gateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    supportsStructuredOutputs: true,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}

export async function extractWithAi(
  businessId: string,
  context: AiExtractionContext,
): Promise<WebChatAiExtraction | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  try {
    const { checkAiCap, recordAiUsage } = await import("@/lib/usage.server");
    const cap = await checkAiCap(businessId);
    if (cap.blocked) return null;

    const result = await generateText({
      model: gateway(apiKey)(ANALYSIS_MODEL),
      output: Output.object({ schema: WebChatAiExtractionSchema }),
      system: buildAiExtractionSystem(context),
      prompt: buildAiExtractionPrompt(context),
    });

    // Bookkeeping, not part of the answer: recorded without making the customer
    // wait for the write. Still counted, still capped on the next turn.
    void recordAiUsage({
      businessId,
      purpose: "web_chat_extraction",
      model: ANALYSIS_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }).catch(() => undefined);

    const parsed = WebChatAiExtractionParseSchema.safeParse(
      (result as unknown as { output?: unknown }).output,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // Extraction is an optimisation, never a dependency.
    return null;
  }
}
