// Lovable AI analysis of a conversation. Output is validated before it can be
// shown; it is never piped straight into an SMS send.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AnalysisSchema = z.object({
  summary: z.string(),
  readiness: z.enum([
    "new",
    "needs_information",
    "quote_ready",
    "high_intent",
    "unclear",
    "not_suitable",
  ]),
  missing_fields: z.array(z.string()),
  extracted: z.object({
    vehicle_type: z.string().nullable(),
    suburb: z.string().nullable(),
    last_cleaned_at: z.string().nullable(),
    main_concerns: z.string().nullable(),
    service_intent: z.string().nullable(),
  }),
  suggested_reply: z.string(),
  needs_human_review: z.boolean(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

function gateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

const BANNED_PATTERNS = [
  /\$\s?\d/,
  /\b\d+\s?(?:dollars|aud)\b/i,
  /\bdiscount|\bspecial offer|\b% off/i,
  /\b(?:tomorrow|today|this (?:morning|afternoon|weekend)|next week)\b/i,
  /\bbooked in\b|\bconfirmed your booking\b|\bavailable at\b/i,
];

/** Strips guard-rail violations rather than trusting the model. */
export function guardReply(reply: string): { reply: string; flagged: string[] } {
  const flagged: string[] = [];
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const safe = sentences.filter((sentence) => {
    const bad = BANNED_PATTERNS.some((pattern) => pattern.test(sentence));
    if (bad) flagged.push(sentence.trim());
    return !bad;
  });
  const cleaned = safe.join(" ").trim();
  return {
    reply:
      cleaned.length > 0
        ? cleaned
        : "Thanks for those details. The Glocast team will confirm the right service and pricing with you shortly.",
    flagged,
  };
}

export async function analyseLead(input: { businessId: string; leadId: string }): Promise<{
  analysis: Analysis;
  flagged: string[];
  aiOutputId: string;
}> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");

  const [{ data: lead }, { data: messages }, { data: services }, { data: business }] =
    await Promise.all([
      supabaseAdmin
        .from("leads")
        .select(
          "id, name, suburb, vehicle_type, last_cleaned_at, main_concerns, service_intent, source_channel, status",
        )
        .eq("id", input.leadId)
        .eq("business_id", input.businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("messages")
        .select("direction, body, created_at")
        .eq("lead_id", input.leadId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("services")
        .select("name, description, price_guidance, included_items, excluded_items")
        .eq("business_id", input.businessId)
        .eq("active", true),
      supabaseAdmin.from("businesses").select("name, service_area").eq("id", input.businessId).single(),
    ]);

  if (!lead) throw new Error("Lead not found for this business.");

  const transcript = (messages ?? [])
    .map((message) => `${message.direction === "inbound" ? "Customer" : "Business"}: ${message.body}`)
    .join("\n");

  const catalogue = (services ?? [])
    .map(
      (service) =>
        `- ${service.name}: ${service.description ?? ""} | Includes: ${service.included_items ?? "n/a"} | Excludes: ${service.excluded_items ?? "n/a"} | Price guidance: ${service.price_guidance ?? "not approved for sharing"}`,
    )
    .join("\n");

  const requestType = (lead as { request_type?: string | null }).request_type ?? null;
  const serviceSnapshot = (lead as { service_name_snapshot?: string | null }).service_name_snapshot ?? null;
  const flexibleText = (lead as { flexible_request_text?: string | null }).flexible_request_text ?? null;
  const ownerReview = Boolean((lead as { requires_owner_review?: boolean | null }).requires_owner_review);

  const system = [
    "You assist an Australian mobile car detailing business with lead qualification.",
    "You are an assistant, not the decision maker. A human always approves messages.",
    "Rules you must never break:",
    "- Never state, quote, estimate or imply a price, dollar figure, discount or deal.",
    "- Never promise availability, dates, times or confirm a booking.",
    "- Never recommend a service that is not in the approved service catalogue.",
    "- Never give mechanical, safety or insurance advice, and never invent details.",
    "- If information is missing, say the owner will confirm it.",
    "- Keep the suggested reply under 320 characters, plain Australian English, no emojis.",
    serviceSnapshot
      ? `- The customer already chose the service "${serviceSnapshot}". Do not switch, upsell or substitute it; work within that request.`
      : "- The customer did not choose an approved service. Do not pick one for them; ask what they need and say the owner will confirm the right option.",
    ownerReview
      ? "- This is a flexible or open request the owner must handle personally. Your reply may only acknowledge and clarify; never propose a specific service or next step."
      : "",
    `Approved service catalogue for ${business?.name ?? "the business"} (service area: ${business?.service_area ?? "unspecified"}):`,
    catalogue || "- No services configured yet.",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "Lead record:",
    JSON.stringify(lead, null, 2),
    "",
    "Request routing:",
    `- Request type: ${requestType ?? "not specified"}`,
    `- Chosen service: ${serviceSnapshot ?? "none chosen"}`,
    `- Customer's own description: ${flexibleText ?? "none"}`,
    "",
    "Conversation so far:",
    transcript || "(no messages yet)",
    "",
    "Extract the structured fields (use null when the customer has not said it), summarise in one or two sentences, classify readiness, list missing fields, and suggest one reply the owner could send.",
  ].join("\n");

  const { checkAiCap, recordAiUsage } = await import("@/lib/usage.server");
  const cap = await checkAiCap(input.businessId);
  if (cap.blocked) throw new Error(cap.reason ?? "Monthly AI safety cap reached.");

  const MODEL = "google/gemini-3.7-flash";
  let output;
  try {
    const generated = await generateText({
      model: gateway(apiKey)(MODEL),
      output: Output.object({ schema: AnalysisSchema }),
      system,
      prompt,
    });
    output = generated.output;
    await recordAiUsage({
      businessId: input.businessId,
      leadId: input.leadId,
      purpose: "lead_analysis",
      model: MODEL,
      inputTokens: generated.usage?.inputTokens ?? 0,
      outputTokens: generated.usage?.outputTokens ?? 0,
    });
  } catch (error) {
    await recordAiUsage({
      businessId: input.businessId,
      leadId: input.leadId,
      purpose: "lead_analysis",
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      status: "failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const parsed = AnalysisSchema.parse(output);
  const guarded = guardReply(parsed.suggested_reply);
  const analysis: Analysis = {
    ...parsed,
    suggested_reply: guarded.reply,
    needs_human_review: true,
  };

  const { data: saved, error } = await supabaseAdmin
    .from("ai_outputs")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId,
      summary: analysis.summary,
      extracted_fields: analysis.extracted,
      missing_fields: analysis.missing_fields,
      readiness: analysis.readiness,
      suggested_reply: analysis.suggested_reply,
      needs_human_review: true,
    })
    .select("id")
    .single();
  if (error || !saved) throw new Error(error?.message ?? "Could not store AI output");

  await supabaseAdmin
    .from("leads")
    .update({ readiness_classification: analysis.readiness })
    .eq("id", input.leadId);

  return { analysis, flagged: guarded.flagged, aiOutputId: saved.id };
}
