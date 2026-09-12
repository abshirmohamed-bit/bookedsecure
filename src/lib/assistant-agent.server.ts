/**
 * The owner assistant's agent loop.
 *
 * The model reads the owner's request, chooses tools, and carries the work out
 * against this tenant's own records. Everything it can touch is defined by
 * `buildAssistantTools`, and the business, user and role are fixed from the
 * authenticated request, so a request can never reach another tenant.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, type ModelMessage } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAssistantTools } from "@/lib/assistant-tools.server";
import { assistantTimeZone, nowInZone } from "@/lib/assistant-time";
import { buildAssistantSystemPrompt } from "@/lib/owner-assistant";
import type { OwnerProposal } from "@/lib/owner-actions.server";

const AGENT_MODEL = "google/gemini-3.8-flash";

function gateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}

export type AssistantAgentResult = {
  answer: string;
  executed: string[];
  proposals: OwnerProposal[];
};

/**
 * Runs one owner request. Returns the assistant's reply, a plain-English line
 * for every change that was actually made, and any Confirm cards (texts,
 * campaigns, imports) the owner must approve before they happen.
 */
export async function runAssistantAgent(input: {
  businessId: string;
  userId: string;
  role: "owner" | "staff" | "platform_admin";
  question: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  attachment?: { filename: string; content: string } | null;
  /** The attached file was uploaded in an earlier message and is being reused. */
  attachmentRemembered?: boolean;
}): Promise<AssistantAgentResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("assistant_unavailable");

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name, timezone")
    .eq("id", input.businessId)
    .maybeSingle();
  const timeZone = assistantTimeZone(business?.timezone ?? null);
  const local = nowInZone(timeZone);

  const executed: string[] = [];
  const proposals: OwnerProposal[] = [];
  const tools = buildAssistantTools({
    businessId: input.businessId,
    userId: input.userId,
    role: input.role,
    timeZone,
    attachment: input.attachment ?? null,
    record: (summary) => executed.push(summary),
    propose: (proposal) => proposals.push(proposal),
  });

  const question = input.attachment
    ? `${input.question}\n\n[${
        input.attachmentRemembered ? "File kept from earlier" : "Attached file"
      }: ${input.attachment.filename}]`
    : input.question;

  const messages: ModelMessage[] = [
    ...(input.history ?? []).slice(-12).map((turn) => ({
      role: turn.role,
      content: turn.text,
    }) as ModelMessage),
    { role: "user", content: question },
  ];

  const result = streamText({
    model: gateway(apiKey)(AGENT_MODEL),
    system: buildAssistantSystemPrompt({
      businessName: business?.name ?? null,
      role: input.role,
      timeZone,
      localDate: local.date,
      localTime: local.time,
      localWeekday: local.weekday,
      hasAttachment: Boolean(input.attachment) && !input.attachmentRemembered,
      ...(input.attachment && input.attachmentRemembered
        ? { rememberedFilename: input.attachment.filename }
        : {}),
    }),
    messages,
    tools,
    stopWhen: stepCountIs(50),
  });

  // Consumed server-side: the request is one-shot, but streaming keeps bytes
  // flowing so a longer tool run is never cut off.
  const answer = (await result.text).trim();
  return { answer, executed, proposals };
}
