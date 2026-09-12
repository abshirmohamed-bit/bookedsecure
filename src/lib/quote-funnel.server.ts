/**
 * Server reads for quote-page measurement and partial prospects.
 *
 * Read-only with one exception: recording that a quote page was opened.
 * Nothing here messages, books, or creates leads, and the unfinished list is
 * deliberately a read path only — see `src/lib/quote-funnel.ts`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildFunnel,
  opensBySource,
  unfinishedProspects,
  type ConversationRow,
  type QuoteAttribution,
  type QuoteFunnel,
  type UnfinishedProspect,
} from "@/lib/quote-funnel";
import type { WebChatCollected } from "@/lib/web-chat";

/** Records one quote-page open with the campaign it came from. */
export async function recordQuotePageOpen(input: {
  slug: string;
  attribution: QuoteAttribution;
  sessionKey?: string | null;
  conversationId?: string | null;
}): Promise<{ ok: boolean }> {
  const { resolvePublicTenant } = await import("@/lib/quote-form.server");
  const tenant = await resolvePublicTenant(input.slug);
  if (!tenant) return { ok: false };

  const { error } = await supabaseAdmin.from("quote_page_events").insert({
    business_id: tenant.businessId,
    slug: input.slug,
    session_key: input.sessionKey ?? null,
    conversation_id: input.conversationId ?? null,
    source: input.attribution.source,
    medium: input.attribution.medium,
    campaign: input.attribution.campaign,
    referrer: input.attribution.referrer,
    landing_url: input.attribution.landingUrl,
    utm: input.attribution.utm as never,
  });
  if (error) {
    // Measurement must never break the customer's conversation.
    console.error("[quote-funnel] open not recorded", error.message);
    return { ok: false };
  }
  return { ok: true };
}

function windowStart(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadConversationRows(
  businessId: string,
  since: string,
): Promise<ConversationRow[]> {
  const { data } = await supabaseAdmin
    .from("web_conversations")
    .select(
      "id, status, collected, lead_id, consent_outcome, mobile_captured_at, created_at, last_activity_at, service_name_snapshot",
    )
    .eq("business_id", businessId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = data ?? [];
  const ids = rows.map((row) => row.id as string);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: messages } = await supabaseAdmin
      .from("web_conversation_messages")
      .select("conversation_id, role")
      .in("conversation_id", ids)
      .eq("role", "customer")
      .limit(20000);
    for (const message of messages ?? []) {
      const key = message.conversation_id as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return rows.map((row) => ({
    id: row.id as string,
    status: row.status as string,
    collected: (row.collected ?? {}) as WebChatCollected,
    leadId: (row.lead_id as string | null) ?? null,
    consentOutcome: (row.consent_outcome as string | null) ?? null,
    mobileCapturedAt: (row.mobile_captured_at as string | null) ?? null,
    createdAt: row.created_at as string,
    lastActivityAt: (row.last_activity_at as string) ?? (row.created_at as string),
    customerMessages: counts.get(row.id as string) ?? 0,
    serviceNameSnapshot: (row.service_name_snapshot as string | null) ?? null,
  }));
}

export type QuoteFunnelReport = QuoteFunnel & {
  days: number;
  bySource: { label: string; count: number }[];
};

/** Funnel for one tenant over the last `days` days. */
export async function loadQuoteFunnel(
  businessId: string,
  days = 30,
): Promise<QuoteFunnelReport> {
  const since = windowStart(days);
  const [rows, opens, bookings] = await Promise.all([
    loadConversationRows(businessId, since),
    supabaseAdmin
      .from("quote_page_events")
      .select("source, campaign")
      .eq("business_id", businessId)
      .gte("created_at", since)
      .limit(20000),
    supabaseAdmin
      .from("booking_offers")
      .select("job_id")
      .eq("business_id", businessId)
      .eq("status", "confirmed")
      .not("job_id", "is", null)
      .gte("created_at", since)
      .limit(5000),
  ]);

  const events = (opens.data ?? []).map((row) => ({
    source: (row.source as string | null) ?? null,
    campaign: (row.campaign as string | null) ?? null,
  }));
  const confirmedBookings = new Set((bookings.data ?? []).map((row) => row.job_id as string)).size;

  return {
    ...buildFunnel({ rows, opens: events.length, confirmedBookings }),
    days,
    bySource: opensBySource(events),
  };
}

/** Partial prospects for one tenant: view only, never contacted by the system. */
export async function loadUnfinishedProspects(
  businessId: string,
  days = 90,
): Promise<UnfinishedProspect[]> {
  const rows = await loadConversationRows(businessId, windowStart(days));
  return unfinishedProspects(rows);
}

/**
 * Removes unfinished quote conversations the owner no longer wants listed
 * (test runs, junk). Only conversations that belong to this business and
 * never became a lead are touched; a conversation with a lead is left alone
 * because the lead inbox owns that record. Dependent chat messages go first;
 * funnel events keep their counts and simply lose the link.
 */
export async function deleteUnfinishedConversations(input: {
  businessId: string;
  userId: string;
  conversationIds: string[];
}): Promise<{ deleted: number; skipped: number }> {
  const ids = Array.from(new Set(input.conversationIds.filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return { deleted: 0, skipped: 0 };

  const { data: owned, error } = await supabaseAdmin
    .from("web_conversations")
    .select("id")
    .eq("business_id", input.businessId)
    .is("lead_id", null)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const deletable = (owned ?? []).map((row) => row.id);
  if (deletable.length === 0) return { deleted: 0, skipped: ids.length };

  const { error: messagesError } = await supabaseAdmin
    .from("web_conversation_messages")
    .delete()
    .in("conversation_id", deletable);
  if (messagesError) throw new Error(messagesError.message);

  const { error: deleteError } = await supabaseAdmin
    .from("web_conversations")
    .delete()
    .eq("business_id", input.businessId)
    .is("lead_id", null)
    .in("id", deletable);
  if (deleteError) throw new Error(deleteError.message);

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: "unfinished_prospects_deleted",
    entity_type: "business",
    entity_id: input.businessId,
    metadata: { conversation_ids: deletable, count: deletable.length } as never,
  });

  return { deleted: deletable.length, skipped: ids.length - deletable.length };
}

/** Marks quiet conversations abandoned so nothing stays "active" forever. */
export async function sweepAbandonedConversations(
  minutes = 1440,
): Promise<{ swept: number }> {
  const { data, error } = await supabaseAdmin.rpc("sweep_abandoned_web_conversations", {
    p_minutes: minutes,
  });
  if (error) {
    console.error("[quote-funnel] sweep failed", error.message);
    return { swept: 0 };
  }
  return { swept: (data as number | null) ?? 0 };
}
