/**
 * Server-side commercial authority for the paid pilot.
 *
 * Reads the singleton commercial_config row, freezes per-pilot terms
 * snapshots, and decides whether a business may send live SMS
 * (`authorizeLiveSend`). All access uses the service-role client — the
 * underlying tables have no client-facing grants, and platform admins reach
 * them only through server functions that pass requirePlatformAdmin first.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  hasMessagingAccess,
  snapshotTerms,
  type CommercialConfig,
  type CommercialTermsSnapshot,
  type PilotAccessState,
  type PilotCommercialRecord,
} from "@/lib/commercial";
import { audit } from "@/lib/audit.server";

type Client = SupabaseClient<Database>;

type ConfigRow = Database["public"]["Tables"]["commercial_config"]["Row"];

function toConfig(row: ConfigRow): CommercialConfig {
  return {
    id: row.id,
    currency: row.currency,
    pilotPriceMinorUnits: row.pilot_price_minor_units,
    billingInterval: row.billing_interval,
    includedSmsSegments: row.included_sms_segments,
    overageMode: row.overage_mode as "hard_cap",
    pilotDurationDays: row.pilot_duration_days,
    supportChannel: row.support_channel,
    supportAddress: row.support_address,
    supportTargetBusinessDays: row.support_target_business_days,
    cancellationTerms: row.cancellation_terms,
    pilotEndAction: row.pilot_end_action,
    stripeProductId: row.stripe_product_id,
    stripeRecurringPriceId: row.stripe_recurring_price_id,
    configurationVersion: row.configuration_version,
    updatedAt: row.updated_at,
  };
}

export async function getCommercialConfig(): Promise<CommercialConfig> {
  const { data, error } = await supabaseAdmin
    .from("commercial_config")
    .select("*")
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error("Commercial configuration is not initialised.");
  return toConfig(data);
}

/**
 * Admin edit of the commercial terms. Bumps configuration_version so pilots
 * invited later snapshot the new terms; already-accepted pilots keep their
 * frozen snapshot (changes never retroactively alter an active pilot).
 */
export async function updateCommercialConfig(
  caller: Client,
  userId: string,
  patch: Partial<
    Pick<
      CommercialConfig,
      | "supportAddress"
      | "supportChannel"
      | "supportTargetBusinessDays"
      | "cancellationTerms"
      | "pilotEndAction"
      | "includedSmsSegments"
      | "pilotDurationDays"
      | "pilotPriceMinorUnits"
    >
  >,
): Promise<CommercialConfig> {
  const { requirePlatformAdmin, auditPilotEvent } = await import("@/lib/pilot.server");
  await requirePlatformAdmin(caller, userId);

  const current = await getCommercialConfig();
  const update: Database["public"]["Tables"]["commercial_config"]["Update"] = {
    configuration_version: current.configurationVersion + 1,
    updated_by: userId,
  };
  if (patch.supportAddress !== undefined) update.support_address = patch.supportAddress;
  if (patch.supportChannel !== undefined) update.support_channel = patch.supportChannel;
  if (patch.supportTargetBusinessDays !== undefined)
    update.support_target_business_days = patch.supportTargetBusinessDays;
  if (patch.cancellationTerms !== undefined) update.cancellation_terms = patch.cancellationTerms;
  if (patch.pilotEndAction !== undefined) update.pilot_end_action = patch.pilotEndAction;
  if (patch.includedSmsSegments !== undefined)
    update.included_sms_segments = patch.includedSmsSegments;
  if (patch.pilotDurationDays !== undefined) update.pilot_duration_days = patch.pilotDurationDays;
  if (patch.pilotPriceMinorUnits !== undefined)
    update.pilot_price_minor_units = patch.pilotPriceMinorUnits;

  const { data, error } = await supabaseAdmin
    .from("commercial_config")
    .update(update)
    .eq("id", current.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await auditPilotEvent({
    actorUserId: userId,
    eventType: "commercial_config_updated",
    entityType: "commercial_config",
    entityId: current.id,
    metadata: { ...patch, configurationVersion: current.configurationVersion + 1 },
  });

  return toConfig(data);
}

/** Freeze the current terms for a specific pilot application. */
export async function freezeTermsForApplication(
  applicationId: string,
  config?: CommercialConfig,
): Promise<CommercialTermsSnapshot> {
  const resolved = config ?? (await getCommercialConfig());
  const snapshot = snapshotTerms(resolved);
  const { error } = await supabaseAdmin
    .from("pilot_applications")
    .update({
      commercial_terms_snapshot: snapshot as never,
      commercial_configuration_version: resolved.configurationVersion,
    })
    .eq("id", applicationId);
  if (error) throw new Error(error.message);
  return snapshot;
}

type PilotRow = Pick<
  Database["public"]["Tables"]["pilot_applications"]["Row"],
  | "id"
  | "business_id"
  | "access_state"
  | "payment_required"
  | "pilot_started_at"
  | "pilot_ends_at"
  | "pilot_extension_ends_at"
  | "commercial_terms_snapshot"
>;

function toPilotRecord(row: PilotRow, config: CommercialConfig): PilotCommercialRecord {
  const snapshot = (row.commercial_terms_snapshot ?? null) as CommercialTermsSnapshot | null;
  return {
    id: row.id,
    businessId: row.business_id,
    accessState: row.access_state as PilotAccessState,
    paymentRequired: row.payment_required,
    pilotStartedAt: row.pilot_started_at,
    pilotEndsAt: row.pilot_ends_at,
    pilotExtensionEndsAt: row.pilot_extension_ends_at,
    includedSmsSegments: snapshot?.includedSmsSegments ?? config.includedSmsSegments,
  };
}

/** The pilot linked to a business, if any (latest wins). */
export async function getPilotForBusiness(
  businessId: string,
): Promise<PilotCommercialRecord | null> {
  const config = await getCommercialConfig();
  const { data } = await supabaseAdmin
    .from("pilot_applications")
    .select(
      "id, business_id, access_state, payment_required, pilot_started_at, pilot_ends_at, pilot_extension_ends_at, commercial_terms_snapshot",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toPilotRecord(data, config) : null;
}

type UsagePeriodRow = Database["public"]["Tables"]["sms_usage_periods"]["Row"];

/** Find or create the usage period covering `now` for a pilot. */
export async function ensureUsagePeriod(
  pilot: PilotCommercialRecord,
  now: Date = new Date(),
): Promise<UsagePeriodRow> {
  const nowIso = now.toISOString();
  const { data: existing } = await supabaseAdmin
    .from("sms_usage_periods")
    .select("*")
    .eq("pilot_application_id", pilot.id)
    .lte("period_start", nowIso)
    .gt("period_end", nowIso)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  // New billing period: anchored on the pilot start (or now if unknown),
  // one month per period, matching the monthly billing interval.
  const anchor = pilot.pilotStartedAt ? new Date(pilot.pilotStartedAt) : now;
  const start = new Date(anchor);
  while (start.getTime() + 30 * 86_400_000 <= now.getTime()) {
    start.setTime(start.getTime() + 30 * 86_400_000);
  }
  const end = new Date(start.getTime() + 30 * 86_400_000);

  const { data, error } = await supabaseAdmin
    .from("sms_usage_periods")
    .insert({
      pilot_application_id: pilot.id,
      business_id: pilot.businessId,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      included_segments: pilot.includedSmsSegments,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export type LiveSendAuthorization =
  | { allowed: true; periodId: string; pilotApplicationId: string }
  | { allowed: false; reason: string };

/**
 * Decide whether a business may send `segments` live SMS segments right now,
 * and atomically reserve them against the pilot's hard cap. The reservation
 * is released by `releaseReservedSegments` if the carrier rejects the send.
 *
 * A business with no linked paid pilot can never send live SMS.
 */
export async function authorizeLiveSend(
  businessId: string,
  segments: number,
  now: Date = new Date(),
): Promise<LiveSendAuthorization> {
  const pilot = await getPilotForBusiness(businessId);
  if (!pilot) {
    return {
      allowed: false,
      reason: "No paid pilot is linked to this business — live messaging is not provisioned.",
    };
  }

  const access = hasMessagingAccess(pilot, now);
  if (!access.allowed) {
    // Lazily record pilot expiry so the state model stays truthful.
    if (access.reason === "The pilot period has ended." && pilot.accessState === "paid") {
      await supabaseAdmin
        .from("pilot_applications")
        .update({ access_state: "pilot_expired", access_state_reason: "Pilot window elapsed" })
        .eq("id", pilot.id);
    }
    return { allowed: false, reason: access.reason };
  }

  const period = await ensureUsagePeriod(pilot, now);
  const { data: reserved, error } = await supabaseAdmin.rpc("reserve_sms_segments", {
    p_period_id: period.id,
    p_segments: segments,
  });

  if (error) throw new Error(error.message);
  if (!reserved) {
    await supabaseAdmin.rpc("record_blocked_sms_segments", {
      p_period_id: period.id,
      p_segments: segments,
    });
    await audit({
      businessId,
      userId: null,
      eventType: "sms_blocked_usage_cap",
      entityType: "business",
      entityId: businessId,
      metadata: {
        segments,
        pilotApplicationId: pilot.id,
        periodId: period.id,
        includedSegments: period.included_segments,
      },
    });
    return {
      allowed: false,
      reason: `Pilot SMS allowance reached (${period.included_segments} segments this billing period). Contact support to continue.`,
    };
  }

  return { allowed: true, periodId: period.id, pilotApplicationId: pilot.id };
}

/** Return segments to the allowance when the carrier rejected the send. */
export async function releaseReservedSegments(periodId: string, segments: number): Promise<void> {
  await supabaseAdmin.rpc("release_sms_segments", { p_period_id: periodId, p_segments: segments });
}
