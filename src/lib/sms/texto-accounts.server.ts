/**
 * Texto multi-tenant account layer.
 *
 * Every business that goes live on Texto gets:
 *   - one row in `texto_accounts` (sub-account id, provisioning state, credits, caps)
 *   - one dedicated number drawn from `texto_numbers` and recorded in `sms_senders`
 *
 * The module keeps two runtime paths:
 *   - simulated: updates local rows only, no external API calls (default until Texto
 *     account is approved and manually switched on)
 *   - live: calls api.texto.com.au for account/credit/number operations
 *
 * All database operations use the service-role client because this layer runs
 * only inside server functions, and authenticated-user access is gated through
 * those functions or the row-level security on the tables themselves.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { PROVIDER_CAPABILITIES } from "./config";

export const TEXTO_API_BASE = "https://api.texto.com.au";

export type ProvisioningState =
  | "not_started"
  | "provisioning"
  | "active"
  | "suspended"
  | "failed"
  | "queued_no_number";

export type TextoAccount = Database["public"]["Tables"]["texto_accounts"]["Row"];
export type TextoNumber = Database["public"]["Tables"]["texto_numbers"]["Row"];

type TextoAccountRow = TextoAccount;

/* ------------------------------------------------------------------ env */

function apiKey(): string | undefined {
  return process.env["TEXTO_API_KEY"];
}

function liveAccountProvisioning(): boolean {
  // Stay simulated by default even when a real key is present, until the
  // platform operator explicitly flips the switch after Texto approval.
  return process.env["TEXTO_ACCOUNT_PROVISIONING"] === "live" && !!apiKey();
}

/* ------------------------------------------------------------------ errors */

export class TextoAccountError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable = false,
  ) {
    super(message);
    this.name = "TextoAccountError";
  }
}

/* ------------------------------------------------------------------ helpers */

function nowIso(): string {
  return new Date().toISOString();
}

async function auditEvent(input: {
  businessId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: null,
    event_type: input.eventType,
    entity_type: "texto_account",
    metadata: (input.metadata ?? null) as Json,
  });
}

/* ------------------------------------------------------------------ account read/write */

export async function getOrCreateTextoAccount(businessId: string): Promise<TextoAccountRow> {
  const { data: existing } = await supabaseAdmin
    .from("texto_accounts")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("texto_accounts")
    .insert({ business_id: businessId, provisioning_state: "not_started" })
    .select("*")
    .single();

  if (error) throw new TextoAccountError(error.message, "db_insert_failed");
  if (!data) throw new TextoAccountError("Account row could not be created.", "db_insert_failed");
  return data;
}

export async function getTextoAccount(businessId: string): Promise<TextoAccountRow | null> {
  const { data } = await supabaseAdmin
    .from("texto_accounts")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  return data;
}

async function updateTextoAccount(
  accountId: string,
  patch: Database["public"]["Tables"]["texto_accounts"]["Update"],
): Promise<TextoAccountRow> {
  const { data, error } = await supabaseAdmin
    .from("texto_accounts")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw new TextoAccountError(error.message, "db_update_failed");
  if (!data) throw new TextoAccountError("Account row not found after update.", "db_update_failed");
  return data;
}

/* ------------------------------------------------------------------ number pool */

export async function listAvailableNumbers(): Promise<TextoNumber[]> {
  const { data, error } = await supabaseAdmin
    .from("texto_numbers")
    .select("*")
    .is("assigned_business_id", null)
    .eq("status", "available")
    .order("created_at", { ascending: true });
  if (error) throw new TextoAccountError(error.message, "db_query_failed");
  return data ?? [];
}

export async function listAssignedNumbers(businessId: string): Promise<TextoNumber[]> {
  const { data, error } = await supabaseAdmin
    .from("texto_numbers")
    .select("*")
    .eq("assigned_business_id", businessId)
    .order("assigned_at", { ascending: false });
  if (error) throw new TextoAccountError(error.message, "db_query_failed");
  return data ?? [];
}

export async function addNumberToPool(input: {
  number: string;
  providerNumberId?: string | null;
  monthlyCostCents?: number;
}): Promise<TextoNumber> {
  const { data, error } = await supabaseAdmin
    .from("texto_numbers")
    .insert({
      number: input.number,
      provider_number_id: input.providerNumberId ?? null,
      monthly_cost_cents: input.monthlyCostCents ?? 1500,
      status: "available",
    })
    .select("*")
    .single();
  if (error) throw new TextoAccountError(error.message, "db_insert_failed");
  if (!data) throw new TextoAccountError("Number could not be added to pool.", "db_insert_failed");
  return data;
}

async function assignPoolNumber(businessId: string, numberId: string): Promise<TextoNumber> {
  const { data, error } = await supabaseAdmin
    .from("texto_numbers")
    .update({
      assigned_business_id: businessId,
      assigned_at: nowIso(),
      recalled_at: null,
      status: "assigned",
    })
    .eq("id", numberId)
    .is("assigned_business_id", null)
    .select("*")
    .single();
  if (error) throw new TextoAccountError(error.message, "db_assign_failed");
  if (!data) throw new TextoAccountError("Number was already assigned.", "pool_concurrency");
  return data;
}

async function recallPoolNumber(businessId: string): Promise<void> {
  await supabaseAdmin
    .from("texto_numbers")
    .update({
      assigned_business_id: null,
      assigned_at: null,
      recalled_at: nowIso(),
      status: "available",
    })
    .eq("assigned_business_id", businessId);
}

async function ensurePrimarySender(
  businessId: string,
  accountId: string,
  phoneNumber: string,
): Promise<void> {
  // Mark any existing primary senders for this business as non-primary so the
  // new Texto number is the one used for outbound messages.
  await supabaseAdmin
    .from("sms_senders")
    .update({ is_primary: false, updated_at: nowIso() })
    .eq("business_id", businessId)
    .eq("is_primary", true);

  const { data: existing } = await supabaseAdmin
    .from("sms_senders")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("sms_senders")
      .update({
        is_primary: true,
        active: true,
        provider: "texto",
        texto_account_id: accountId,
        updated_at: nowIso(),
      })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("sms_senders").insert({
      business_id: businessId,
      phone_number: phoneNumber,
      provider: "texto",
      credential_mode: "platform",
      is_primary: true,
      active: true,
      texto_account_id: accountId,
    });
  }
}

/* ------------------------------------------------------------------ live Texto API */

async function textoRequest<T>(path: string, init: RequestInit): Promise<T> {
  const key = apiKey();
  if (!key) throw new TextoAccountError("TEXTO_API_KEY is not configured.", "missing_key");

  const url = `${TEXTO_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new TextoAccountError(
      `Texto API ${path} failed [${response.status}]: ${raw}`,
      "provider_error",
      response.status >= 500,
    );
  }
  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    return {} as T;
  }
}

async function createTextoSubAccount(businessName: string, ownerEmail: string): Promise<string> {
  const body = await textoRequest<{ id?: string; reference?: string }>("/account", {
    method: "POST",
    body: JSON.stringify({ name: businessName, email: ownerEmail }),
  });
  const id = body.id ?? body.reference;
  if (!id) throw new TextoAccountError("Texto did not return a sub-account id.", "provider_error");
  return id;
}

async function updateTextoSubAccount(subaccountId: string, patch: { daily_send_cap?: number }) {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function allocateTextoCredits(subaccountId: string, credits: number): Promise<void> {
  await textoRequest<{ ok?: boolean }>("/credits/allocate", {
    method: "POST",
    body: JSON.stringify({ account_id: subaccountId, credits }),
  });
}

async function recallTextoCredits(subaccountId: string, credits: number): Promise<void> {
  await textoRequest<{ ok?: boolean }>("/credits/recall", {
    method: "POST",
    body: JSON.stringify({ account_id: subaccountId, credits }),
  });
}

async function assignTextoProviderNumber(
  subaccountId: string,
  number: string,
): Promise<{ providerNumberId: string | null }> {
  const body = await textoRequest<{ id?: string; number_id?: string }>("/numbers/assign", {
    method: "POST",
    body: JSON.stringify({ account_id: subaccountId, number }),
  });
  return { providerNumberId: body.id ?? body.number_id ?? null };
}

async function recallTextoProviderNumber(subaccountId: string, number: string): Promise<void> {
  await textoRequest("/numbers/recall", {
    method: "POST",
    body: JSON.stringify({ account_id: subaccountId, number }),
  });
}

/* ------------------------------------------------------------------ provisioning */

export type ProvisionResult =
  | { ok: true; account: TextoAccountRow; number: TextoNumber }
  | { ok: false; account: TextoAccountRow; reason: string; queued: boolean };

/**
 * Idempotent provisioning for a business. Safe to re-run.
 *
 * If the business already has an active Texto account with an assigned number,
 * returns it immediately. Otherwise it creates the account, allocates credits,
 * and assigns the next available number from the pool.
 */
export async function provisionTextoAccount(input: {
  businessId: string;
  businessName: string;
  ownerEmail: string;
  startingCredits?: number;
  dailySendCap?: number;
}): Promise<ProvisionResult> {
  const businessId = input.businessId;
  const businessName = input.businessName;
  const ownerEmail = input.ownerEmail;
  const startingCredits = input.startingCredits ?? 0;
  const dailySendCap = input.dailySendCap ?? 100;

  let account = await getOrCreateTextoAccount(businessId);

  // Already active with a number — nothing to do.
  const assigned = await listAssignedNumbers(businessId);
  if (account.provisioning_state === "active" && assigned.length > 0 && assigned[0]) {
    return { ok: true, account, number: assigned[0] };
  }

  // Move to provisioning.
  if (account.provisioning_state !== "provisioning") {
    account = await updateTextoAccount(account.id, { provisioning_state: "provisioning" });
  }

  try {
    if (liveAccountProvisioning()) {
      if (!account.subaccount_id) {
        const subaccountId = await createTextoSubAccount(businessName, ownerEmail);
        account = await updateTextoAccount(account.id, {
          subaccount_id: subaccountId,
          subaccount_reference: subaccountId,
        });
      }
      await updateTextoSubAccount(account.subaccount_id!, { daily_send_cap: dailySendCap });
      if (startingCredits > 0) {
        await allocateTextoCredits(account.subaccount_id!, startingCredits);
      }
    }

    account = await updateTextoAccount(account.id, {
      allocated_credits: account.allocated_credits + startingCredits,
      credit_balance: account.credit_balance + startingCredits,
      daily_send_cap: dailySendCap,
      provisioned_at: nowIso(),
    });

    const available = await listAvailableNumbers();
    const nextNumber = available[0];
    if (!nextNumber) {
      account = await updateTextoAccount(account.id, { provisioning_state: "queued_no_number" });
      await auditEvent({
        businessId,
        eventType: "texto_provision_queued_no_number",
        metadata: { account_id: account.id },
      });
      return {
        ok: false,
        account,
        reason:
          "No dedicated numbers are available in the pool. The business is queued and you will be alerted.",
        queued: true,
      };
    }

    const number = await assignPoolNumber(businessId, nextNumber.id);

    if (liveAccountProvisioning() && account.subaccount_id) {
      const { providerNumberId } = await assignTextoProviderNumber(
        account.subaccount_id,
        number.number,
      );
      await supabaseAdmin
        .from("texto_numbers")
        .update({ provider_number_id: providerNumberId })
        .eq("id", number.id);
    }

    await ensurePrimarySender(businessId, account.id, number.number);

    account = await updateTextoAccount(account.id, { provisioning_state: "active" });

    await auditEvent({
      businessId,
      eventType: "texto_provision_succeeded",
      metadata: {
        account_id: account.id,
        number_id: number.id,
        number: number.number,
        live: liveAccountProvisioning(),
        starting_credits: startingCredits,
      },
    });

    return { ok: true, account, number };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    account = await updateTextoAccount(account.id, {
      provisioning_state: "failed",
      failed_reason: message,
    });
    await auditEvent({
      businessId,
      eventType: "texto_provision_failed",
      metadata: { account_id: account.id, error: message },
    });
    return { ok: false, account, reason: message, queued: false };
  }
}

/* ------------------------------------------------------------------ credit lifecycle */

export async function allocateCredits(businessId: string, credits: number): Promise<TextoAccountRow> {
  const account = await getOrCreateTextoAccount(businessId);
  if (liveAccountProvisioning() && account.subaccount_id && credits > 0) {
    await allocateTextoCredits(account.subaccount_id, credits);
  }
  const updated = await updateTextoAccount(account.id, {
    credit_balance: account.credit_balance + credits,
    allocated_credits: account.allocated_credits + credits,
  });
  await auditEvent({
    businessId,
    eventType: "texto_credits_allocated",
    metadata: { credits, new_balance: updated.credit_balance },
  });
  return updated;
}

export async function recallCredits(businessId: string, credits: number): Promise<TextoAccountRow> {
  const account = await getOrCreateTextoAccount(businessId);
  const amount = Math.min(credits, account.credit_balance);
  if (liveAccountProvisioning() && account.subaccount_id && amount > 0) {
    await recallTextoCredits(account.subaccount_id, amount);
  }
  const updated = await updateTextoAccount(account.id, {
    credit_balance: account.credit_balance - amount,
  });
  await auditEvent({
    businessId,
    eventType: "texto_credits_recalled",
    metadata: { requested: credits, recalled: amount, new_balance: updated.credit_balance },
  });
  return updated;
}

/* ------------------------------------------------------------------ number recall */

export async function recallTextoNumber(businessId: string): Promise<void> {
  const account = await getTextoAccount(businessId);
  const assigned = await listAssignedNumbers(businessId);
  if (account?.subaccount_id && liveAccountProvisioning()) {
    for (const number of assigned) {
      await recallTextoProviderNumber(account.subaccount_id, number.number);
    }
  }
  await recallPoolNumber(businessId);
  await supabaseAdmin
    .from("sms_senders")
    .update({ active: false, is_primary: false, updated_at: nowIso() })
    .eq("business_id", businessId)
    .eq("provider", "texto");
  await auditEvent({
    businessId,
    eventType: "texto_number_recalled",
    metadata: { count: assigned.length },
  });
}

/* ------------------------------------------------------------------ send-path guards */

export type CreditCheckResult =
  | { ok: true; account: TextoAccountRow }
  | { ok: false; reason: string };

export type DailyCapCheckResult =
  | { ok: true; sentToday: number; cap: number }
  | { ok: false; reason: string; sentToday: number; cap: number };

async function countMessagesSentToday(businessId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("direction", "outbound")
    .gte("created_at", start.toISOString());
  if (error) throw new TextoAccountError(error.message, "db_query_failed");
  return count ?? 0;
}

/**
 * Check whether a business has enough Texto credits to send right now.
 * Does not deduct credits; the send path should call this before the provider
 * call and then record spend via `recordMessageSpend`.
 */
export async function checkTextoCredits(
  businessId: string,
  _segments: number,
): Promise<CreditCheckResult> {
  const account = await getTextoAccount(businessId);
  if (!account) {
    return { ok: false, reason: "No Texto account is provisioned for this business." };
  }
  if (account.provisioning_state !== "active") {
    return {
      ok: false,
      reason: `Texto account is ${account.provisioning_state} — messaging is not live yet.`,
    };
  }
  // Texto charges 1 credit per outbound message; segments are tracked locally for
  // reporting but credits are message-level on the platform side.
  if (account.credit_balance < 1) {
    return {
      ok: false,
      reason: "Texto credit balance is empty. Please top up to continue sending.",
    };
  }
  return { ok: true, account };
}

/**
 * Check the per-business daily send cap. Blocks only automated sends once the
 * cap is reached; owner-initiated messages are still gated by credit balance and
 * the pilot allowance but are allowed through the daily cap so urgent replies
 * are not silently dropped.
 */
export async function checkTextoDailyCap(
  businessId: string,
  automated: boolean,
): Promise<DailyCapCheckResult> {
  const account = await getTextoAccount(businessId);
  const cap = account?.daily_send_cap ?? 100;
  const sentToday = await countMessagesSentToday(businessId);
  if (sentToday >= cap && automated) {
    return {
      ok: false,
      reason: `Daily send cap reached (${sentToday}/${cap}). Add more credits or raise the cap to continue.`,
      sentToday,
      cap,
    };
  }
  return { ok: true, sentToday, cap };
}

/**
 * Deduct one credit per outbound message after a successful provider acceptance.
 * Keeps the local balance in sync with Texto; the authoritative balance is always
 * Texto's, reconciled periodically by the reporting job.
 */
export async function recordMessageSpend(businessId: string, segments: number): Promise<void> {
  const account = await getTextoAccount(businessId);
  if (!account) return;
  const newBalance = Math.max(0, account.credit_balance - 1);
  await updateTextoAccount(account.id, { credit_balance: newBalance });
  await auditEvent({
    businessId,
    eventType: "texto_credits_consumed",
    metadata: { segments, new_balance: newBalance },
  });
}

/* ------------------------------------------------------------------ reports */

export type TextoAccountReport = {
  messagesOut: number;
  messagesIn: number;
  delivered: number;
  failed: number;
  optOuts: number;
  creditsUsed: number;
};

export async function getTextoAccountReport(
  businessId: string,
  window: { from: string; to: string },
): Promise<TextoAccountReport> {
  const account = await getTextoAccount(businessId);
  if (liveAccountProvisioning() && account?.subaccount_id) {
    const body = await textoRequest<{
      summary?: {
        messages_out?: number;
        messages_in?: number;
        delivered?: number;
        failed?: number;
        opt_outs?: number;
        credits_used?: number;
      };
    }>(`/account/${encodeURIComponent(account.subaccount_id)}/report?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, {
      method: "GET",
    });
    const s = body.summary ?? {};
    return {
      messagesOut: s.messages_out ?? 0,
      messagesIn: s.messages_in ?? 0,
      delivered: s.delivered ?? 0,
      failed: s.failed ?? 0,
      optOuts: s.opt_outs ?? 0,
      creditsUsed: s.credits_used ?? 0,
    };
  }

  // Simulated / local aggregation from messages and consent_events.
  const { data: outbound } = await supabaseAdmin
    .from("messages")
    .select("id, delivery_status")
    .eq("business_id", businessId)
    .eq("direction", "outbound")
    .gte("created_at", window.from)
    .lte("created_at", window.to);

  const { data: inbound } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("business_id", businessId)
    .eq("direction", "inbound")
    .gte("created_at", window.from)
    .lte("created_at", window.to);

  const { data: optOuts } = await supabaseAdmin
    .from("consent_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_type", "opt_out")
    .gte("created_at", window.from)
    .lte("created_at", window.to);

  const failed = (outbound ?? []).filter((m) => m.delivery_status === "failed").length;
  const delivered = (outbound ?? []).filter((m) => m.delivery_status === "delivered").length;

  return {
    messagesOut: outbound?.length ?? 0,
    messagesIn: inbound?.length ?? 0,
    delivered,
    failed,
    optOuts: optOuts?.length ?? 0,
    creditsUsed: outbound?.length ?? 0,
  };
}

export type TextoGroupReport = {
  totalMessagesOut: number;
  totalCreditsUsed: number;
  totalDelivered: number;
  totalFailed: number;
  accounts: number;
};

export async function getTextoGroupReport(window: {
  from: string;
  to: string;
}): Promise<TextoGroupReport> {
  if (liveAccountProvisioning()) {
    const body = await textoRequest<{
      summary?: {
        messages_out?: number;
        credits_used?: number;
        delivered?: number;
        failed?: number;
        accounts?: number;
      };
    }>(`/report/group?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, {
      method: "GET",
    });
    const s = body.summary ?? {};
    return {
      totalMessagesOut: s.messages_out ?? 0,
      totalCreditsUsed: s.credits_used ?? 0,
      totalDelivered: s.delivered ?? 0,
      totalFailed: s.failed ?? 0,
      accounts: s.accounts ?? 0,
    };
  }

  const { data: outbound } = await supabaseAdmin
    .from("messages")
    .select("business_id, delivery_status")
    .eq("direction", "outbound")
    .gte("created_at", window.from)
    .lte("created_at", window.to);

  const failed = (outbound ?? []).filter((m) => m.delivery_status === "failed").length;
  const delivered = (outbound ?? []).filter((m) => m.delivery_status === "delivered").length;
  const accounts = new Set(outbound?.map((m) => m.business_id) ?? []).size;

  return {
    totalMessagesOut: outbound?.length ?? 0,
    totalCreditsUsed: outbound?.length ?? 0,
    totalDelivered: delivered,
    totalFailed: failed,
    accounts,
  };
}

/* ------------------------------------------------------------------ capability query */

export function textoAccountCapabilities(): Pick<
  typeof PROVIDER_CAPABILITIES.texto,
  "provisionAccount" | "updateAccount" | "allocateCredits" | "recallCredits" | "getAccountReport" | "getGroupReport"
> {
  const live = liveAccountProvisioning();
  return {
    provisionAccount: live,
    updateAccount: live,
    allocateCredits: live,
    recallCredits: live,
    getAccountReport: live,
    getGroupReport: live,
  };
}
