// Delivers due owner schedule reminders. Reads the latest bookings at send
// time, reuses the tenant's own sending line and text-credit rules, and never
// touches customer booking confirmations.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvider } from "@/lib/sms/provider.server";
import { resolveEffectiveProviderName } from "@/lib/sms/resolution";
import { resolveSender } from "@/lib/lead-engine.server";
import { countSegments } from "@/lib/sms/segments";
import { renderOwnerScheduleReminder } from "@/lib/owner-schedule-reminder";
import { FOUNDER_PLAN_ID } from "@/lib/plans";

type Row = {
  id: string;
  business_id: string;
  range_start: string;
  range_end: string;
  label: string;
};

async function finish(id: string, patch: Record<string, unknown>, businessId: string, outcome: string) {
  await supabaseAdmin.from("owner_sms_reminders").update(patch as never).eq("id", id);
  await supabaseAdmin.from("audit_events").insert({
    business_id: businessId,
    event_type: "owner_sms_reminder_delivery",
    entity_type: "business",
    entity_id: businessId,
    metadata: { reminder_id: id, outcome } as never,
  });
}

async function deliver(row: Row): Promise<"sent" | "failed"> {
  const fail = async (reason: string, parts = 0, ids: string[] = []) => {
    await finish(row.id, { status: "failed", failure_reason: reason.slice(0, 300), parts_sent: parts, provider_message_ids: ids }, row.business_id, "failed");
    return "failed" as const;
  };
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("timezone, default_sms_provider, owner_notification_number, plan_id")
    .eq("id", row.business_id)
    .maybeSingle();
  if (!business?.owner_notification_number) return fail("No owner alert mobile saved.");

  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("scheduled_at, service_performed, leads!inner(name, suburb, service_name_snapshot, deleted_at)")
    .eq("business_id", row.business_id)
    .eq("completion_status", "scheduled")
    .gte("scheduled_at", row.range_start)
    .lt("scheduled_at", row.range_end)
    .is("leads.deleted_at", null)
    .order("scheduled_at")
    .limit(500);
  if (error) return fail(`Bookings could not be read: ${error.message}`);

  const parts = renderOwnerScheduleReminder({
    label: row.label,
    timeZone: business.timezone ?? "Australia/Sydney",
    bookings: (jobs ?? []).map((j) => {
      const lead = (Array.isArray(j.leads) ? j.leads[0] : j.leads) as { name: string | null; suburb: string | null; service_name_snapshot: string | null } | null;
      return {
        scheduledAt: j.scheduled_at as string,
        customerName: lead?.name ?? null,
        serviceName: (j.service_performed as string | null) ?? lead?.service_name_snapshot ?? null,
        suburb: lead?.suburb ?? null,
      };
    }),
  });

  const sender = await resolveSender({ businessId: row.business_id });
  if (!sender) return fail("No active sending number for this business.");
  const provider = getProvider(resolveEffectiveProviderName(business.default_sms_provider, sender.provider));
  const free = business.plan_id === FOUNDER_PLAN_ID;
  const ids: string[] = [];

  for (const body of parts) {
    const { segments } = countSegments(body);
    let periodId: string | null = null;
    let credits = 0;
    if (!free && provider.name !== "simulated") {
      const { authorizeLiveSend } = await import("@/lib/commercial.server");
      const gate = await authorizeLiveSend(row.business_id, segments);
      if (!gate.allowed) return fail(gate.reason, ids.length, ids);
      periodId = gate.periodId;
      credits = gate.creditsSpent;
    }
    try {
      const result = await provider.sendMessage({ to: business.owner_notification_number, body, sender });
      ids.push(result.providerMessageId ?? "");
      if (credits > 0) {
        const { recordMessageSpend } = await import("@/lib/subscription.server");
        await recordMessageSpend(row.business_id, credits);
      }
    } catch (err) {
      if (periodId) {
        const { releaseReservedSegments } = await import("@/lib/commercial.server");
        await releaseReservedSegments(periodId, segments);
      }
      if (credits > 0) {
        const { refundPurchasedCredits } = await import("@/lib/subscription.server");
        await refundPurchasedCredits(row.business_id, credits);
      }
      return fail(provider.formatProviderError(err), ids.length, ids);
    }
  }
  await finish(row.id, { status: "sent", sent_at: new Date().toISOString(), parts_sent: ids.length, provider_message_ids: ids, failure_reason: null }, row.business_id, "sent");
  return "sent";
}

/** Claims and sends every reminder that is due. Each row is claimed once. */
export async function processDueOwnerReminders(now = new Date()) {
  const { data: due } = await supabaseAdmin
    .from("owner_sms_reminders")
    .select("id")
    .eq("status", "scheduled")
    .lte("send_at", now.toISOString())
    .order("send_at")
    .limit(25);
  let sent = 0;
  let failed = 0;
  for (const { id } of due ?? []) {
    const { data: claimed } = await supabaseAdmin
      .from("owner_sms_reminders")
      .update({ status: "sending" })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id, business_id, range_start, range_end, label")
      .maybeSingle();
    if (!claimed) continue;
    try {
      (await deliver(claimed as Row)) === "sent" ? sent++ : failed++;
    } catch (err) {
      failed++;
      await finish(id, { status: "failed", failure_reason: String(err).slice(0, 300) }, claimed.business_id, "failed");
    }
  }
  return { sent, failed };
}
