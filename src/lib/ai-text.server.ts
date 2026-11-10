/**
 * One short AI text answer for a business, through withAiBackup (the
 * platform-selected primary, then the standby, then tenant keys), with the
 * monthly AI cap checked and usage recorded. Shared by small AI helpers
 * (YouTube replies and titles, Lead finder suggestions).
 */
export async function aiText(businessId: string, purpose: string, system: string, prompt: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("The AI service is not configured.");
  const { checkAiCap, recordAiUsage } = await import("./usage.server");
  if ((await checkAiCap(businessId)).blocked) throw new Error("This month's AI limit is reached.");
  const { generateText, streamText } = await import("ai");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const { withAiBackup } = await import("./tenant-ai.server");
  const { ANALYSIS_MODEL } = await import("./ai.server");
  const gateway = createOpenAICompatible({ name: "lovable", baseURL: "https://ai.gateway.lovable.dev/v1", headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const result = await withAiBackup({
    businessId, role: "fast", usage: { source: "lovable" },
    gateway: async () => { const r = await generateText({ model: gateway(ANALYSIS_MODEL), system, prompt }); return { text: r.text, input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 }; },
    backup: async (provider) => { const r = streamText({ ...provider, maxRetries: 0, system, prompt, onError: () => undefined }); const u = await r.usage; return { text: await r.text, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 }; },
  });
  await recordAiUsage({ businessId, purpose, model: ANALYSIS_MODEL, inputTokens: result.input, outputTokens: result.output }).catch(() => undefined);
  return result.text.trim();
}
