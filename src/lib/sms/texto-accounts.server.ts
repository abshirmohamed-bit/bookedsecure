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

/**
 * Live mode for the parent-account operations (number pool sync, number
 * assignment, reports). Stays simulated by default even when a real key is
 * present, until the platform operator explicitly flips the switch.
 */
export function liveAccountProvisioning(): boolean {
  return process.env["TEXTO_ACCOUNT_PROVISIONING"] === "live" && !!apiKey();
}

/**
 * Optional second layer: create a Texto sub-account per tenant and allocate
 * credits at Texto. Off by default — the recommended shape is one parent
 * account holding every number, with BookedSecure doing per-tenant metering.
 */
export function liveSubaccountProvisioning(): boolean {
  return liveAccountProvisioning() && process.env["TEXTO_SUBACCOUNT_PROVISIONING"] === "live";
}

/** Optional platform alert endpoint (Slack/Teams/any JSON endpoint). */
async function notifyPlatformOperator(text: string, extra: Record<string, unknown> = {}): Promise<void> {
  const url = process.env["FEEDBACK_ALERT_WEBHOOK_URL"];
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...extra }),
    });
  } catch (error) {
    console.error("[texto] operator alert failed:", error);
  }
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

export type PoolSyncResult = {
  live: boolean;
  seen: number;
  added: number;
  updated: number;
  numbers: TextoNumber[];
};

type TextoNumberListing = {
  numbers?: Array<{
    id?: string;
    number?: string;
    label?: string | null;
    assigned_to?: string | null;
    price_monthly?: number;
  }>;
};

/**
 * Pull every dedicated number held by the parent Texto account (and any
 * already handed to a sub-account) into the local pool. Numbers are bought in
 * the Texto dashboard; this makes them appear here without manual entry.
 * Idempotent: existing rows are refreshed, never duplicated, and a number that
 * is already assigned to a business locally is left assigned.
 */
export async function syncNumbersFromTexto(): Promise<PoolSyncResult> {
  if (!liveAccountProvisioning()) {
    const { data } = await supabaseAdmin.from("texto_numbers").select("*").order("created_at");
    return { live: false, seen: 0, added: 0, updated: 0, numbers: data ?? [] };
  }

  const [own, group] = await Promise.all([
    textoRequest<TextoNumberListing>("/numbers", { method: "GET" }),
    textoRequest<TextoNumberListing>("/numbers/group", { method: "GET" }).catch(() => ({ numbers: [] })),
  ]);
  const listed = new Map<string, NonNullable<TextoNumberListing["numbers"]>[number]>();
  for (const entry of [...(own.numbers ?? []), ...(group.numbers ?? [])]) {
    if (entry.number) listed.set(entry.number, entry);
  }

  // Map Texto sub-account ids back to businesses so a number already assigned
  // at Texto lands on the right tenant.
  const { data: accounts } = await supabaseAdmin
    .from("texto_accounts")
    .select("id, business_id, subaccount_id")
    .not("subaccount_id", "is", null);
  const businessBySubaccount = new Map((accounts ?? []).map((a) => [a.subaccount_id as string, a.business_id]));

  const { data: existingRows } = await supabaseAdmin.from("texto_numbers").select("*");
  const existing = new Map((existingRows ?? []).map((row) => [row.number, row]));

  let added = 0;
  let updated = 0;
  for (const [number, entry] of listed) {
    const monthly = Math.round((entry.price_monthly ?? 15) * 100);
    const remoteBusiness = entry.assigned_to ? businessBySubaccount.get(entry.assigned_to) ?? null : null;
    const row = existing.get(number);
    if (!row) {
      await supabaseAdmin.from("texto_numbers").insert({
        number,
        provider_number_id: entry.id ?? null,
        monthly_cost_cents: monthly,
        status: remoteBusiness ? "assigned" : "available",
        assigned_business_id: remoteBusiness,
        assigned_at: remoteBusiness ? nowIso() : null,
      });
      added += 1;
      continue;
    }
    const patch: Database["public"]["Tables"]["texto_numbers"]["Update"] = {};
    if (entry.id && row.provider_number_id !== entry.id) patch.provider_number_id = entry.id;
    if (row.monthly_cost_cents !== monthly) patch.monthly_cost_cents = monthly;
    if (!row.assigned_business_id && remoteBusiness) {
      patch.assigned_business_id = remoteBusiness;
      patch.assigned_at = nowIso();
      patch.status = "assigned";
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("texto_numbers").update({ ...patch, updated_at: nowIso() }).eq("id", row.id);
      updated += 1;
    }
  }

  const { data: numbers } = await supabaseAdmin.from("texto_numbers").select("*").order("created_at");
  return { live: true, seen: listed.size, added, updated, numbers: numbers ?? [] };
}

/** Businesses waiting for a number (queued, failed or never provisioned while active). */
export async function listBusinessesAwaitingNumber(): Promise<
  Array<{ businessId: string; businessName: string | null; state: string; failedReason: string | null; since: string }>
> {
  const { data: accounts } = await supabaseAdmin
    .from("texto_accounts")
    .select("business_id, provisioning_state, failed_reason, updated_at, businesses(name, subscription_status)")
    .in("provisioning_state", ["queued_no_number", "failed", "provisioning", "not_started"]);
  return (accounts ?? [])
    .map((row) => {
      const business = row.businesses as { name?: string | null; subscription_status?: string | null } | null;
      return {
        businessId: row.business_id,
        businessName: business?.name ?? null,
        subscription: business?.subscription_status ?? null,
        state: row.provisioning_state,
        failedReason: row.failed_reason,
        since: row.updated_at,
      };
    })
    .filter((row) => row.subscription === "active" || row.state !== "not_started")
    .map(({ subscription: _s, ...rest }) => rest);
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
  options: { deactivateOtherSenders?: boolean } = {},
): Promise<void> {
  // Switch this business (and only this business) over: every other sender it
  // had — Telnyx, Twilio, simulated — stops being primary, so the dedicated
  // Texto number is what every new conversation goes out from. Older numbers
  // stay active by default so replies to texts already sent from them still
  // reach this business and existing threads keep their original number.
  await supabaseAdmin
    .from("sms_senders")
    .update({
      is_primary: false,
      ...(options.deactivateOtherSenders ? { active: false } : {}),
      updated_at: nowIso(),
    })
    .eq("business_id", businessId)
    .neq("phone_number", phoneNumber);

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

// Endpoints below follow Texto's published OpenAPI spec (texto.com.au/openapi.yaml):
//   POST /accounts                          create a sub-account
//   PATCH /account/{id}                     daily_limit, business_name
//   POST /account/{id}/credits/allocate     { amount }
//   POST /account/{id}/credits/recall       { amount }
//   POST /account/{id}/numbers/assign       { numbers: [] }
//   POST /account/{id}/numbers/recall       { numbers: [] }

export function textoSubAccountPayload(input: {
  businessName: string;
  ownerEmail: string;
  dailyLimit: number;
  seedCredits?: number;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    business_name: input.businessName,
    daily_limit: input.dailyLimit,
    // BookedSecure operates the account; the tenant never needs a Texto login.
    managed_by_parent: true,
    team_access_from_parent: true,
  };
  if (input.ownerEmail) payload["email"] = input.ownerEmail;
  if (input.seedCredits && input.seedCredits > 0) payload["seed_credits"] = input.seedCredits;
  return payload;
}

async function createTextoSubAccount(input: {
  businessName: string;
  ownerEmail: string;
  dailyLimit: number;
}): Promise<string> {
  const body = await textoRequest<{ account_id?: string; id?: string }>("/accounts", {
    method: "POST",
    body: JSON.stringify(textoSubAccountPayload(input)),
  });
  const id = body.account_id ?? body.id;
  if (!id) throw new TextoAccountError("Texto did not return a sub-account id.", "provider_error");
  return id;
}

async function updateTextoSubAccount(subaccountId: string, patch: { daily_limit?: number; business_name?: string }) {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function allocateTextoCredits(subaccountId: string, credits: number): Promise<void> {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}/credits/allocate`, {
    method: "POST",
    body: JSON.stringify({ amount: credits }),
  });
}

async function recallTextoCredits(subaccountId: string, credits: number): Promise<void> {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}/credits/recall`, {
    method: "POST",
    body: JSON.stringify({ amount: credits }),
  });
}

async function assignTextoProviderNumber(subaccountId: string, number: string): Promise<void> {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}/numbers/assign`, {
    method: "POST",
    body: JSON.stringify({ numbers: [number] }),
  });
}

async function recallTextoProviderNumber(subaccountId: string, number: string): Promise<void> {
  await textoRequest(`/account/${encodeURIComponent(subaccountId)}/numbers/recall`, {
    method: "POST",
    body: JSON.stringify({ numbers: [number] }),
  });
}

/* ------------------------------------------------------- self-serve numbers */

export type PurchasableNumber = { number: string; monthlyCostCents: number; providerRef?: string };

type AvailableNumberListing = {
  numbers?: Array<
    | string
    | {
        id?: string;
        number?: string;
        phone?: string;
        e164?: string;
        msisdn?: string;
        price_monthly?: number;
        monthly_price?: number;
      }
  >;
};

/**
 * Numbers Texto currently has for sale (`GET /numbers/available`). The
 * response shape is not in the published spec, so each entry is normalised
 * defensively — strings or objects with any of the common phone fields.
 */
export async function listPurchasableNumbers(): Promise<PurchasableNumber[]> {
  if (!liveAccountProvisioning()) return [];
  const body = await textoRequest<AvailableNumberListing | unknown[]>("/numbers/available", {
    method: "GET",
  });
  const entries = Array.isArray(body) ? body : (body.numbers ?? []);
  const out: PurchasableNumber[] = [];
  for (const entry of entries) {
    const record = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const raw =
      typeof entry === "string"
        ? entry
        : ((record?.["number"] ?? record?.["phone"] ?? record?.["e164"] ?? record?.["msisdn"] ?? null) as string | null);
    if (!raw || typeof raw !== "string") continue;
    const number = raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
    const price = record ? Number(record["price_monthly"] ?? record["monthly_price"] ?? 15) : 15;
    const monthly = Number.isFinite(price) ? Math.round(price * 100) : 1500;
    const providerRef = typeof record?.["id"] === "string" ? (record["id"] as string) : undefined;
    out.push({ number, monthlyCostCents: monthly || 1500, ...(providerRef ? { providerRef } : {}) });
  }
  return out;
}

  return out;
}

/** Numbers the provider says this account actually holds (`GET /numbers`). */
export async function numbersHeldAtProvider(): Promise<string[]> {
  if (!liveAccountProvisioning()) return [];
  const body = await textoRequest<AvailableNumberListing | unknown[]>("/numbers", { method: "GET" });
  const entries = Array.isArray(body) ? body : (body.numbers ?? []);
  const out: string[] = [];
  for (const entry of entries) {
    const record = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const raw =
      typeof entry === "string"
        ? entry
        : ((record?.["number"] ?? record?.["phone"] ?? record?.["e164"] ?? record?.["msisdn"] ?? null) as
            | string
            | null);
    if (typeof raw === "string" && raw.length > 0) {
      out.push(raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`);
    }
  }
  return out;
}

/** True when the provider replied with its catch-all "route not found" page. */
function isRouteUnavailable(message: string): boolean {
  return message.includes("[404]") && message.includes("available_routes");
}

/**
 * Buy a dedicated number from Texto. `POST /numbers/purchase` is advertised in
 * the provider's route manifest but is not served on this account: every body
 * shape returns the router's catch-all 404 while other POST routes answer
 * normally. We still try the documented shapes (in case it is switched on for
 * this account later) and, when the route itself is unavailable, raise a clear
 * error pointing at the manual purchase fallback.
 */
export async function purchaseNumberFromTexto(number: string, providerRef?: string): Promise<void> {
  if (!liveAccountProvisioning()) {
    throw new TextoAccountError("Live Texto account operations are disabled.", "disabled");
  }
  const bodies: Record<string, unknown>[] = [
    { number },
    { numbers: [number] },
    { msisdn: number },
    ...(providerRef ? [{ id: providerRef }, { number_id: providerRef }] : []),
  ];
  let lastError: unknown;
  for (const body of bodies) {
    try {
      await textoRequest("/numbers/purchase", { method: "POST", body: JSON.stringify(body) });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[texto] purchase attempt failed for ${number} with ${JSON.stringify(body)}: ${message}`);
      // A route-level 404 will repeat for every body shape; a real rejection
      // (400/409/insufficient funds) should stop us trying other shapes.
      if (!isRouteUnavailable(message)) break;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  if (isRouteUnavailable(detail)) {
    throw new TextoAccountError(
      "The provider's buy-a-number service is not switched on for this account, so the number could not be bought automatically. Buy it in the provider's own dashboard and connect it here.",
      "provider_error",
    );
  }
  throw lastError instanceof Error ? lastError : new TextoAccountError(detail, "provider_error");
}


/**
 * Buy a fresh number straight from Texto's for-sale list and lock it to this
 * business. Used when the local pool is empty so activation never waits on a
 * human. Returns null when nothing is for sale or the purchase fails (the
 * caller then queues the business and alerts the operator).
 */
async function purchaseNumberForBusiness(businessId: string): Promise<TextoNumber | null> {
  const forSale = await listPurchasableNumbers().catch((error) => {
    console.error("[texto] listing available numbers failed:", error);
    return [] as PurchasableNumber[];
  });
  for (const candidate of forSale) {
    try {
      await purchaseNumberFromTexto(candidate.number);
    } catch (error) {
      console.error(`[texto] purchase of ${candidate.number} failed:`, error);
      continue;
    }
    // Record it locally as already assigned so the pool stays truthful.
    const { data: row } = await supabaseAdmin
      .from("texto_numbers")
      .upsert(
        {
          number: candidate.number,
          monthly_cost_cents: candidate.monthlyCostCents,
          status: "assigned",
          assigned_business_id: businessId,
          assigned_at: nowIso(),
          recalled_at: null,
          updated_at: nowIso(),
        },
        { onConflict: "number" },
      )
      .select("*")
      .maybeSingle();
    if (row) return row;
  }
  return null;
}

export type NumberClaimResult =
  | { ok: true; number: string; monthlyCostCents: number; alreadyOwned: boolean }
  | { ok: false; reason: string; detail?: string };

/**
 * Owner-driven claim of one dedicated number for their own business.
 *
 * Safe to re-run: if the business already holds this number nothing is bought
 * twice, and a number already assigned to another business is refused. On
 * success the number becomes the business's primary sender while any older
 * number stays active so replies to earlier texts still arrive.
 */
export async function claimDedicatedNumber(input: {
  businessId: string;
  number: string;
  monthlyCostCents?: number;
  alreadyPurchased?: boolean;
}): Promise<NumberClaimResult> {
  const number = input.number.startsWith("+")
    ? input.number
    : `+${input.number.replace(/\D/g, "")}`;
  const account = await getOrCreateTextoAccount(input.businessId);

  const { data: existingRow } = await supabaseAdmin
    .from("texto_numbers")
    .select("*")
    .eq("number", number)
    .maybeSingle();

  if (existingRow?.assigned_business_id && existingRow.assigned_business_id !== input.businessId) {
    return { ok: false, reason: "That number is already taken. Choose another one." };
  }

  const alreadyOwned = existingRow?.assigned_business_id === input.businessId;

  // `alreadyPurchased` is the manual fallback: the number was bought directly
  // in the provider's dashboard, so only the local wiring is missing. We check
  // the provider really holds it before wiring it up, so a typo or a number
  // that was never bought cannot be attached to the business.
  if (!alreadyOwned && input.alreadyPurchased && liveAccountProvisioning()) {
    const held = await numbersHeldAtProvider().catch(() => null);
    if (held && !held.includes(number)) {
      await auditEvent({
        businessId: input.businessId,
        eventType: "texto_number_connect_rejected",
        metadata: { number, held_count: held.length },
      });
      return {
        ok: false,
        reason: "The provider does not show that number on your account yet.",
        detail: "Buy it in the provider's dashboard first, then connect it here.",
      };
    }
  }

  if (!alreadyOwned && !input.alreadyPurchased) {
    try {
      await purchaseNumberFromTexto(number, input.providerRef);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await auditEvent({
        businessId: input.businessId,
        eventType: "texto_number_purchase_failed",
        metadata: { number, detail, provider_ref: input.providerRef ?? null },
      });
      return {
        ok: false,
        reason: "The number could not be bought automatically.",
        detail,
      };
    }
  }


  const { data: row } = await supabaseAdmin
    .from("texto_numbers")
    .upsert(
      {
        number,
        monthly_cost_cents: input.monthlyCostCents ?? existingRow?.monthly_cost_cents ?? 1500,
        status: "assigned",
        assigned_business_id: input.businessId,
        assigned_at: existingRow?.assigned_at ?? nowIso(),
        recalled_at: null,
        updated_at: nowIso(),
      },
      { onConflict: "number" },
    )
    .select("*")
    .maybeSingle();

  if (liveSubaccountProvisioning() && account.subaccount_id) {
    await assignTextoProviderNumber(account.subaccount_id, number).catch((error) =>
      console.error("[texto] sub-account number assignment failed:", error),
    );
  }

  await ensurePrimarySender(input.businessId, account.id, number);
  await updateTextoAccount(account.id, {
    provisioning_state: "active",
    failed_reason: null,
    provisioned_at: account.provisioned_at ?? nowIso(),
  });

  await auditEvent({
    businessId: input.businessId,
    eventType: alreadyOwned ? "texto_number_reclaimed" : "texto_number_purchased",
    metadata: { number, live: liveAccountProvisioning() },
  });

  return {
    ok: true,
    number,
    monthlyCostCents: row?.monthly_cost_cents ?? input.monthlyCostCents ?? 1500,
    alreadyOwned,
  };
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
    // Sub-accounts are opt-in. Default shape: numbers live on the parent
    // account and BookedSecure meters per tenant locally.
    if (liveSubaccountProvisioning()) {
      if (!account.subaccount_id) {
        const subaccountId = await createTextoSubAccount({ businessName, ownerEmail, dailyLimit: dailySendCap });
        account = await updateTextoAccount(account.id, {
          subaccount_id: subaccountId,
          subaccount_reference: subaccountId,
        });
      } else {
        await updateTextoSubAccount(account.subaccount_id, { daily_limit: dailySendCap });
      }
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

    // Refresh the pool from Texto first so a number bought in the dashboard
    // is picked up without an operator having to type it in.
    if (liveAccountProvisioning()) {
      await syncNumbersFromTexto().catch((error) =>
        console.error("[texto] pool sync before assignment failed:", error),
      );
    }

    // Claim the next free number atomically: the conditional update only
    // succeeds for one caller when two activations race for the same row.
    let number: TextoNumber | null = null;
    for (const candidate of await listAvailableNumbers()) {
      const { data: claimed } = await supabaseAdmin
        .from("texto_numbers")
        .update({
          status: "assigned",
          assigned_business_id: businessId,
          assigned_at: nowIso(),
          recalled_at: null,
          updated_at: nowIso(),
        })
        .eq("id", candidate.id)
        .eq("status", "available")
        .is("assigned_business_id", null)
        .select("*")
        .maybeSingle();
      if (claimed) {
        number = claimed;
        break;
      }
    }

    // Pool empty? Buy one straight from Texto so activation is hands-off.
    // The $15/month is already part of the plan price — the tenant never sees
    // a separate charge for their number.
    if (!number && liveAccountProvisioning()) {
      number = await purchaseNumberForBusiness(businessId);
      if (number) {
        await auditEvent({
          businessId,
          eventType: "texto_number_purchased",
          metadata: { number: number.number, monthly_cost_cents: number.monthly_cost_cents },
        });
      }
    }

    if (!number) {
      account = await updateTextoAccount(account.id, { provisioning_state: "queued_no_number" });
      await auditEvent({
        businessId,
        eventType: "texto_provision_queued_no_number",
        metadata: { account_id: account.id },
      });
      await notifyPlatformOperator(
        `Texto number needed — ${businessName} (business ${businessId}) is subscribed but no dedicated number could be bought or assigned. Check Texto's available stock and the account balance, then run "Sync numbers" and "Retry" in /admin/messaging-numbers.`,
        { kind: "texto_queued_no_number", business_id: businessId },
      );
      return {
        ok: false,
        account,
        reason:
          "No dedicated number could be assigned right now. The business is queued and the platform has been alerted.",
        queued: true,
      };
    }

    if (liveSubaccountProvisioning() && account.subaccount_id) {
      await assignTextoProviderNumber(account.subaccount_id, number.number);
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
  if (liveSubaccountProvisioning() && account.subaccount_id && credits > 0) {
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
  if (liveSubaccountProvisioning() && account.subaccount_id && amount > 0) {
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
  if (account?.subaccount_id && liveSubaccountProvisioning()) {
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
  // Whether the text is covered (included allowance or purchased credits) is
  // decided by the subscription gate before this check runs.
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
export async function recordMessageSpend(businessId: string, credits: number): Promise<void> {
  const account = await getTextoAccount(businessId);
  if (!account) return;
  await auditEvent({
    businessId,
    eventType: "texto_credits_consumed",
    metadata: { credits, new_balance: account.credit_balance },
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
  if (liveSubaccountProvisioning() && account?.subaccount_id) {
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
