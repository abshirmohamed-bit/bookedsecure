/**
 * Owner assistant orchestration.
 *
 * Reads a snapshot of the caller's own tenant records and asks the model to
 * phrase an answer. Every read is scoped by `business_id`; nothing is written,
 * sent or scheduled here.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBookings } from "@/lib/bookings.server";
import { upcomingBookings } from "@/lib/bookings";
import {
  buildOwnerAssistantSystem,
  classifyOwnerQuestion,
  guardAssistantAnswer,
  renderSnapshotAnswer,
  type OwnerSnapshot,
} from "@/lib/owner-assistant";

const ASSISTANT_MODEL = "google/gemini-3.7-flash";

function gateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Tenant-scoped, read-only snapshot of the numbers the assistant may quote. */
export async function loadOwnerSnapshot(businessId: string): Promise<OwnerSnapshot> {
  const nowIso = new Date().toISOString();
  const [{ data: business }, { data: leads }, { data: jobs }, { data: campaigns }, { data: drafts }] =
    await Promise.all([
      supabaseAdmin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      supabaseAdmin
        .from("leads")
        .select("id, status, created_at, first_reply_at")
        .eq("business_id", businessId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("jobs")
        .select("scheduled_at, completed_at, completed_value, completion_status")
        .eq("business_id", businessId),
      supabaseAdmin
        .from("reactivation_campaigns")
        .select("id, status, offer_text, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("reactivation_drafts")
        .select("campaign_id, status")
        .eq("business_id", businessId),
    ]);

  const leadRows = leads ?? [];
  const jobRows = jobs ?? [];
  const campaignRows = campaigns ?? [];
  const latest = campaignRows[0] ?? null;
  const latestDrafts = latest ? (drafts ?? []).filter((row) => row.campaign_id === latest.id) : [];

  const since7 = daysAgo(7);
  const since30 = daysAgo(30);
  const closed = new Set(["won", "lost", "archived", "closed"]);

  const upcoming = jobRows.filter(
    (job) => job.scheduled_at && job.scheduled_at >= nowIso && job.completion_status !== "completed",
  );
  const nextScheduledAt =
    upcoming
      .map((job) => job.scheduled_at as string)
      .sort()
      .at(0) ?? null;
  const completedRecent = jobRows.filter(
    (job) => job.completion_status === "completed" && job.completed_at && job.completed_at >= since30,
  );

  return {
    businessName: business?.name ?? null,
    generatedAt: nowIso,
    timezone: null,
    leads: {
      total: leadRows.length,
      new: leadRows.filter((lead) => lead.status === "new").length,
      last7Days: leadRows.filter((lead) => lead.created_at >= since7).length,
      awaitingReply: leadRows.filter(
        (lead) => lead.first_reply_at && !closed.has(String(lead.status)),
      ).length,
    },
    bookings: {
      upcoming: upcoming.length,
      nextScheduledAt,
      completedLast30Days: completedRecent.length,
      revenueLast30Days: completedRecent.reduce(
        (total, job) => total + Number(job.completed_value ?? 0),
        0,
      ),
      upcomingList: upcomingBookings(await loadBookings(businessId), nowIso)
        .slice(0, 5)
        .map((entry) => ({
          customerName: entry.customerName,
          serviceName: entry.serviceName,
          scheduledAt: entry.scheduledAt as string,
        })),
    },
    campaigns: {
      total: campaignRows.length,
      openStatus: latest?.status ?? null,
      openOffer: latest?.offer_text ?? null,
      drafted: latestDrafts.filter((row) => row.status === "draft").length,
      sent: latestDrafts.filter((row) => row.status === "sent").length,
      replied: latestDrafts.filter((row) => row.status === "replied").length,
    },
  };
}

export type OwnerAnswer = {
  answer: string;
  source: "ai" | "snapshot";
  snapshot: OwnerSnapshot;
};

/**
 * Answers one owner question. The deterministic snapshot answer is always the
 * fallback, so a model outage or a guard-rail strip never leaves the owner
 * without a factual reply.
 */
export async function answerOwnerQuestion(input: {
  businessId: string;
  question: string;
}): Promise<OwnerAnswer> {
  const snapshot = await loadOwnerSnapshot(input.businessId);
  const intent = classifyOwnerQuestion(input.question);
  const deterministic = renderSnapshotAnswer(snapshot, intent);

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || input.question.trim().length === 0) {
    return { answer: deterministic, source: "snapshot", snapshot };
  }

  try {
    const result = await generateText({
      model: gateway(apiKey)(ASSISTANT_MODEL),
      system: buildOwnerAssistantSystem(snapshot),
      prompt: input.question,
    });
    const guarded = guardAssistantAnswer(result.text ?? "");
    if (guarded.length === 0) return { answer: deterministic, source: "snapshot", snapshot };
    return { answer: guarded, source: "ai", snapshot };
  } catch {
    return { answer: deterministic, source: "snapshot", snapshot };
  }
}
