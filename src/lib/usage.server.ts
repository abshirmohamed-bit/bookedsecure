// Per-business SMS and AI usage tracking, monthly safety caps and alerts.
// Server-only: never imported by client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type UsageLimits = {
  monthly_segment_cap: number;
  monthly_ai_cost_cap: number;
  alert_threshold_pct: number;
  hard_block: boolean;
  last_alert_sent_at: string | null;
};

const DEFAULT_LIMITS: UsageLimits = {
  // Matches the plan's included allowance (1,000 texts) so the safety cap and
  // the paid allowance can never contradict each other.
  monthly_segment_cap: 1000,
  monthly_ai_cost_cap: 25,
  alert_threshold_pct: 80,
  hard_block: true,
  last_alert_sent_at: null,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function getUsageLimits(businessId: string): Promise<UsageLimits> {
  const { data } = await supabaseAdmin
    .from("usage_limits")
    .select("monthly_segment_cap, monthly_ai_cost_cap, alert_threshold_pct, hard_block, last_alert_sent_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (data) return data as UsageLimits;
  await supabaseAdmin.from("usage_limits").insert({ business_id: businessId });
  return DEFAULT_LIMITS;
}

/** Adds to today's rollup for this business. Creates the row on first use. */
export async function recordSmsUsage(input: {
  businessId: string;
  segmentsOut?: number;
  messagesOut?: number;
  segmentsIn?: number;
  failures?: number;
  providerCost?: number;
}): Promise<void> {
  const date = today();
  const { data: existing } = await supabaseAdmin
    .from("sms_usage_daily")
    .select("id, segments_out, messages_out, segments_in, failures, provider_cost")
    .eq("business_id", input.businessId)
    .eq("usage_date", date)
    .maybeSingle();

  const add = {
    segments_out: input.segmentsOut ?? 0,
    messages_out: input.messagesOut ?? 0,
    segments_in: input.segmentsIn ?? 0,
    failures: input.failures ?? 0,
    provider_cost: input.providerCost ?? 0,
  };

  if (!existing) {
    await supabaseAdmin
      .from("sms_usage_daily")
      .insert({ business_id: input.businessId, usage_date: date, ...add });
    return;
  }

  await supabaseAdmin
    .from("sms_usage_daily")
    .update({
      segments_out: existing.segments_out + add.segments_out,
      messages_out: existing.messages_out + add.messages_out,
      segments_in: existing.segments_in + add.segments_in,
      failures: existing.failures + add.failures,
      provider_cost: Number(existing.provider_cost) + add.provider_cost,
    })
    .eq("id", existing.id);
}

export async function monthlySmsSegments(businessId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("sms_usage_daily")
    .select("segments_out")
    .eq("business_id", businessId)
    .gte("usage_date", monthStart());
  return (data ?? []).reduce((total, row) => total + (row.segments_out ?? 0), 0);
}

export async function monthlyAiCost(businessId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("ai_usage_events")
    .select("estimated_cost")
    .eq("business_id", businessId)
    .gte("created_at", `${monthStart()}T00:00:00Z`);
  return (data ?? []).reduce((total, row) => total + Number(row.estimated_cost ?? 0), 0);
}

async function alertIfNeeded(input: {
  businessId: string;
  kind: "sms" | "ai";
  used: number;
  cap: number;
  limits: UsageLimits;
}) {
  if (input.cap <= 0) return;
  const pct = (input.used / input.cap) * 100;
  if (pct < input.limits.alert_threshold_pct) return;

  const last = input.limits.last_alert_sent_at ? new Date(input.limits.last_alert_sent_at) : null;
  if (last && Date.now() - last.getTime() < 12 * 60 * 60 * 1000) return;

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    event_type: `usage_alert_${input.kind}`,
    entity_type: "business",
    entity_id: input.businessId,
    metadata: { used: input.used, cap: input.cap, percent: Math.round(pct) } as never,
  });
  await supabaseAdmin
    .from("usage_limits")
    .update({ last_alert_sent_at: new Date().toISOString() })
    .eq("business_id", input.businessId);
}

export type CapCheck = { blocked: boolean; reason?: string; used: number; cap: number };

/** Monthly SMS segment safety cap. Only automated sends are blocked. */
export async function checkSmsCap(input: {
  businessId: string;
  segments: number;
}): Promise<CapCheck> {
  const limits = await getUsageLimits(input.businessId);
  const used = await monthlySmsSegments(input.businessId);
  await alertIfNeeded({
    businessId: input.businessId,
    kind: "sms",
    used,
    cap: limits.monthly_segment_cap,
    limits,
  });
  const over = used + input.segments > limits.monthly_segment_cap;
  return {
    blocked: over && limits.hard_block,
    ...(over
      ? {
          reason: `Monthly SMS safety cap reached (${used}/${limits.monthly_segment_cap} segments). Raise the cap in Settings to continue.`,
        }
      : {}),
    used,
    cap: limits.monthly_segment_cap,
  };
}

export async function checkAiCap(businessId: string): Promise<CapCheck> {
  const limits = await getUsageLimits(businessId);
  const used = await monthlyAiCost(businessId);
  await alertIfNeeded({
    businessId,
    kind: "ai",
    used,
    cap: Number(limits.monthly_ai_cost_cap),
    limits,
  });
  const over = used >= Number(limits.monthly_ai_cost_cap);
  return {
    blocked: over && limits.hard_block,
    ...(over
      ? { reason: `Monthly AI safety cap reached ($${used.toFixed(2)}). Raise the cap in Settings to continue.` }
      : {}),
    used,
    cap: Number(limits.monthly_ai_cost_cap),
  };
}

// Rough Lovable AI gateway pricing for the model we use (AUD per 1M tokens).
const AI_PRICE_PER_MILLION = { input: 0.45, output: 1.8 };

export async function recordAiUsage(input: {
  businessId: string;
  leadId?: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status?: "success" | "failed";
  errorDetail?: string | null;
  billingSource?: 'lovable' | 'tenant' | 'external';
}): Promise<number> {
  const cost = input.billingSource && input.billingSource !== 'lovable' ? 0 :
    (input.inputTokens / 1_000_000) * AI_PRICE_PER_MILLION.input +
    (input.outputTokens / 1_000_000) * AI_PRICE_PER_MILLION.output;

  await supabaseAdmin.from("ai_usage_events").insert({
    business_id: input.businessId,
    lead_id: input.leadId ?? null,
    purpose: input.purpose,
    model: input.model,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    estimated_cost: cost,
    status: input.status ?? "success",
    error_detail: input.errorDetail ?? null,
  });

  return cost;
}
