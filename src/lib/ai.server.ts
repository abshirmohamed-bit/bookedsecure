// Lovable AI analysis of a conversation. Output is validated before it can be
// shown; it is never piped straight into an SMS send.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildBusinessSettingsContext } from "@/lib/ai-context";
import {
  AnalysisSchema,
  buildRepairInstruction,
  failureMessage,
  parseAnalysisPayload,
  type Analysis,
} from "@/lib/ai-analysis-contract";
import {
  buildApprovedFacts,
  buildApprovedFactsContext,
  hasApprovedPrice,
  type ApprovedFacts,
} from "@/lib/approved-facts";

export { AnalysisSchema };
export type { Analysis };

function gateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    // Strict json_schema: without this the gateway is asked for a bare
    // json_object and the model invents its own field names, which the schema
    // then rejects ("No object generated").
    supportsStructuredOutputs: true,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}


// Sentences containing a price are allow-listable: they survive only when the
// price text is traceable to the current tenant's approved price guidance.
const PRICE_PATTERNS = [/\$\s?\d/, /\b\d+\s?(?:dollars|aud)\b/i];

// Never allow-listable: discounts, percentages, fees, taxes, deposits, final or
// guaranteed price claims, inspection-conditional price promises.
const UNSAFE_PRICING_PATTERNS = [
  /\bdiscount|\bspecial offer|\b%\s?off|\b\d+\s?%/i,
  /\bfee\b|\bfees\b|\bsurcharge\b|\bdeposit\b|\btax\b|\bgst\b|\blevy\b/i,
  /\bfinal price\b|\btotal (?:is|will be|comes)\b|\bguarantee|\bguaranteed\b|\bwill cost\b|\bcosts you\b/i,
  /\bafter (?:an )?inspection\b|\bon inspection it (?:will|would)\b/i,
];

// Never allow-listable: dates, times, availability, scheduling, bookings.
const BANNED_PATTERNS = [
  /\b(?:tomorrow|today|tonight|this (?:morning|afternoon|evening|weekend)|next week|this week)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\bbooked in\b|\byou are booked\b|\bconfirmed your booking\b|\bbooking is confirmed\b/i,
  /\bappointment\b|\bslot\b|\bschedul/i,
  /\bavailab/i,
];

const FALLBACK_REPLY =
  "Thanks for those details. The Glocast team will confirm the right service and pricing with you shortly.";

/** Formatting-only normalisation. Never changes the underlying claim. */
function normalisePriceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\$\s+(?=\d)/g, "$")
    .replace(/\s*-\s*/g, "-")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips guard-rail violations rather than trusting the model.
 *
 * `approvedFacts` is the allow-list and is passed separately from general
 * Business Settings context: only its exact `priceGuidance` can justify a
 * price. Without it, every price is stripped, as in Phase 1.
 */
export function guardReply(
  reply: string,
  approvedFacts?: ApprovedFacts | null,
): { reply: string; flagged: string[] } {
  const priceAllowed = hasApprovedPrice(approvedFacts);
  const approvedPrice = priceAllowed ? normalisePriceText(approvedFacts!.priceGuidance!) : "";

  const flagged: string[] = [];
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const safe = sentences.filter((sentence) => {
    let bad = [...BANNED_PATTERNS, ...UNSAFE_PRICING_PATTERNS].some((pattern) =>
      pattern.test(sentence),
    );
    if (!bad && PRICE_PATTERNS.some((pattern) => pattern.test(sentence))) {
      bad = true;
      if (priceAllowed && !UNSAFE_PRICING_PATTERNS.some((p) => p.test(sentence))) {
        const normalised = normalisePriceText(sentence);
        const index = normalised.indexOf(approvedPrice);
        if (index >= 0) {
          // Any price figure beyond the approved guidance is unsupported.
          const residual =
            normalised.slice(0, index) + " " + normalised.slice(index + approvedPrice.length);
          bad = PRICE_PATTERNS.some((pattern) => pattern.test(residual));
        }
      }
    }
    if (bad) flagged.push(sentence.trim());
    return !bad;
  });
  const cleaned = safe.join(" ").trim();
  return { reply: cleaned.length > 0 ? cleaned : FALLBACK_REPLY, flagged };
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
          "id, name, suburb, vehicle_type, last_cleaned_at, main_concerns, service_intent, source_channel, status, request_type, approved_service_id, service_name_snapshot, flexible_request_text, requires_owner_review",
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
        .select(
          "id, business_id, name, description, price_guidance, included_items, excluded_items, qualification_note, active",
        )
        .eq("business_id", input.businessId)
        .eq("active", true),
      supabaseAdmin
        .from("businesses")
        .select(
          "name, service_area, timezone, opening_hours, quiet_hours_start, quiet_hours_end, sms_signature, privacy_policy_url",
        )
        .eq("id", input.businessId)
        .single(),
    ]);

  if (!lead) throw new Error("Lead not found for this business.");

  const transcript = (messages ?? [])
    .map((message) => `${message.direction === "inbound" ? "Customer" : "Business"}: ${message.body}`)
    .join("\n");

  // Business Settings are the single source of truth for operational facts.
  const settingsContext = business
    ? buildBusinessSettingsContext(business, services ?? [])
    : "Business Settings unavailable — do not state any operational facts.";

  // The allow-list: built from this tenant's active services plus the lead's
  // own snapshot, and passed separately from the general settings context.
  const approvedFacts = buildApprovedFacts({
    businessId: input.businessId,
    lead: lead as never,
    services: (services ?? []) as never,
  });

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
    "- Business Settings are operational context only. They are NEVER a source of pricing language.",
    "- Only the Approved facts (allow-list) block may be used for pricing. Quote its exact approved price guidance verbatim or state no price at all.",
    "- Never infer, calculate, combine, narrow, total or invent a price, and never add fees, taxes, deposits, discounts or percentages.",
    "- If the approved facts contain no price guidance, or the requested service is ambiguous, ask a neutral clarifying question and say the owner will confirm.",
    "- Never claim or confirm a date, time, availability, slot, appointment or booking.",
    "- You may record the customer's stated timing preference in extracted.requested_day_or_time using their own words only (e.g. \"weekend mornings\"). Leave it null if they gave none, and never turn it into a specific date, time or slot.",
    "- Appointment options and booking confirmations are produced by the system, not by you. If the customer asks when you can come, say the owner will send available times.",
    "- Keep the suggested reply under 320 characters, plain Australian English, no emojis.",
    serviceSnapshot
      ? `- The customer already chose the service "${serviceSnapshot}". Do not switch, upsell or substitute it; work within that request.`
      : "- The customer did not choose an approved service. Do not pick one for them; ask what they need and say the owner will confirm the right option.",
    ownerReview
      ? "- This is a flexible or open request the owner must handle personally. Your reply may only acknowledge and clarify; never propose a specific service or next step."
      : "",
    settingsContext,
    buildApprovedFactsContext(approvedFacts),
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
  const guarded = guardReply(parsed.suggested_reply, approvedFacts);
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
