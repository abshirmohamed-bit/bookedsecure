/**
 * Feedback storage and platform alerting.
 *
 * Each submission is stamped with the sending business and user, so every
 * report is traceable to one tenant. Alerting is deliberately simple and
 * always-on: the row lands in the platform review queue and an audit event is
 * written, so nothing can be lost if an outbound channel is unavailable.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { FeedbackKind, FeedbackStatus } from "@/lib/feedback";

export type FeedbackRow = {
  id: string;
  businessId: string;
  businessName: string | null;
  userId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  kind: FeedbackKind;
  message: string;
  pagePath: string | null;
  status: FeedbackStatus;
  internalNote: string | null;
  createdAt: string;
};

export async function recordFeedback(input: {
  businessId: string;
  userId: string;
  kind: FeedbackKind;
  message: string;
  pagePath?: string | null;
  contactEmail?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("feedback_submissions")
    .insert({
      business_id: input.businessId,
      user_id: input.userId,
      kind: input.kind,
      message: input.message,
      page_path: input.pagePath ?? null,
      contact_email: input.contactEmail ?? null,
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "That feedback could not be saved.");

  const id = data.id as string;

  // Platform alert trail: visible in the admin feedback queue and audited.
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: input.kind === "issue_report" ? "feedback_issue_reported" : "feedback_feature_requested",
    entity_type: "feedback_submission",
    entity_id: id,
    metadata: {
      kind: input.kind,
      page_path: input.pagePath ?? null,
      preview: input.message.slice(0, 280),
    } as never,
  } as never);

  await notifyPlatform({
    id,
    businessId: input.businessId,
    kind: input.kind,
    message: input.message,
    pagePath: input.pagePath ?? null,
  });

  return { id };
}

/**
 * Optional outbound alert. When `FEEDBACK_ALERT_WEBHOOK_URL` is configured
 * (Slack, Teams, or any JSON endpoint) a short summary is posted there. A
 * failure never blocks the tenant: the stored row remains the source of truth.
 */
async function notifyPlatform(input: {
  id: string;
  businessId: string;
  kind: FeedbackKind;
  message: string;
  pagePath: string | null;
}): Promise<void> {
  const url = process.env["FEEDBACK_ALERT_WEBHOOK_URL"];
  if (!url) return;

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name")
    .eq("id", input.businessId)
    .maybeSingle();

  const heading =
    input.kind === "issue_report" ? "New issue reported" : "New feature/tool request";
  const text = [
    `${heading}. ${(business as { name?: string | null } | null)?.name ?? "Unknown business"}`,
    `Business ID: ${input.businessId}`,
    input.pagePath ? `Page: ${input.pagePath}` : null,
    "",
    input.message,
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, feedback_id: input.id, kind: input.kind }),
    });
  } catch {
    // Alerting is best-effort; the queue row is authoritative.
  }
}

export async function listFeedback(filter?: {
  status?: FeedbackStatus | "all";
}): Promise<FeedbackRow[]> {
  let query = supabaseAdmin
    .from("feedback_submissions")
    .select(
      "id, business_id, user_id, kind, message, page_path, contact_email, status, internal_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter?.status && filter.status !== "all") query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const businessIds = [...new Set(rows.map((row) => row.business_id as string))];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
  const [{ data: businesses }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name").in("id", businessIds),
    userIds.length
      ? supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; email: string | null }[] }),
  ]);

  const nameByBusiness = new Map((businesses ?? []).map((row) => [row.id as string, row.name as string | null]));
  const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]));

  return rows.map((row) => {
    const profile = row.user_id ? profileById.get(row.user_id as string) : undefined;
    return {
      id: row.id as string,
      businessId: row.business_id as string,
      businessName: nameByBusiness.get(row.business_id as string) ?? null,
      userId: (row.user_id as string | null) ?? null,
      senderName: (profile?.name as string | null) ?? null,
      senderEmail: (row.contact_email as string | null) ?? (profile?.email as string | null) ?? null,
      kind: row.kind as FeedbackKind,
      message: row.message as string,
      pagePath: (row.page_path as string | null) ?? null,
      status: row.status as FeedbackStatus,
      internalNote: (row.internal_note as string | null) ?? null,
      createdAt: row.created_at as string,
    } satisfies FeedbackRow;
  });
}

export async function updateFeedback(input: {
  id: string;
  status?: FeedbackStatus;
  internalNote?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.status) patch["status"] = input.status;
  if (input.internalNote !== undefined) patch["internal_note"] = input.internalNote;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabaseAdmin
    .from("feedback_submissions")
    .update(patch as never)
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}
