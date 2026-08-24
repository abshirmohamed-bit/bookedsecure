// Metric computation. Completed-job revenue only ever comes from completed jobs.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SourceRow = {
  source: string;
  leads: number;
  medianResponseMinutes: number | null;
  replyRate: number;
  completedJobs: number;
  completedRevenue: number;
  averageJobValue: number | null;
  completedRate: number;
};

export type Funnel = {
  enquiries: number;
  contacted: number;
  replied: number;
  quoteReady: number;
  quoteSent: number;
  scheduled: number;
  completed: number;
  lost: number;
};

export type Metrics = {
  totalLeads: number;
  medianResponseMinutes: number | null;
  withinFiveMinutes: number;
  replyRate: number;
  completedJobs: number;
  completedRevenue: number;
  averageJobValue: number | null;
  needsFollowUp: number;
  optOuts: number;
  deliveryFailures: number;
  formCompletionRate: number;
  funnel: Funnel;
  bySource: SourceRow[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

type LeadRow = {
  id: string;
  status: string;
  source_channel: string;
  created_at: string;
  first_contacted_at: string | null;
  first_reply_at: string | null;
  opted_out_at: string | null;
  vehicle_type: string | null;
  main_concerns: string | null;
  suburb: string | null;
};

type JobRow = {
  lead_id: string;
  completed_at: string | null;
  completed_value: number | null;
  completion_status: string;
};

function responseMinutes(lead: LeadRow): number | null {
  if (!lead.first_contacted_at) return null;
  return (
    (new Date(lead.first_contacted_at).getTime() - new Date(lead.created_at).getTime()) / 60000
  );
}

export async function computeMetrics(
  businessId: string,
  range?: { from?: string | null; to?: string | null; source?: string | null },
): Promise<Metrics> {
  let leadQuery = supabaseAdmin
    .from("leads")
    .select(
      "id, status, source_channel, created_at, first_contacted_at, first_reply_at, opted_out_at, vehicle_type, main_concerns, suburb",
    )
    .eq("business_id", businessId);

  if (range?.from) leadQuery = leadQuery.gte("created_at", range.from);
  if (range?.to) leadQuery = leadQuery.lte("created_at", range.to);
  if (range?.source) leadQuery = leadQuery.eq("source_channel", range.source);

  const [{ data: leadsData }, { data: jobsData }, { data: failures }, { data: conversations }] =
    await Promise.all([
      leadQuery,
      supabaseAdmin
        .from("jobs")
        .select("lead_id, completed_at, completed_value, completion_status")
        .eq("business_id", businessId),
      supabaseAdmin
        .from("messages")
        .select("id")
        .eq("business_id", businessId)
        .in("delivery_status", ["failed", "undelivered"]),
      supabaseAdmin
        .from("conversations")
        .select("lead_id, next_follow_up_at, status")
        .eq("business_id", businessId),
    ]);

  const leads = (leadsData ?? []) as LeadRow[];
  const jobs = (jobsData ?? []) as JobRow[];
  const leadIds = new Set(leads.map((lead) => lead.id));
  const completedJobs = jobs.filter(
    (job) => job.completion_status === "completed" && job.completed_at && leadIds.has(job.lead_id),
  );

  const responseTimes = leads.map(responseMinutes).filter((value): value is number => value !== null);
  const replied = leads.filter((lead) => lead.first_reply_at).length;
  const revenue = completedJobs.reduce((total, job) => total + Number(job.completed_value ?? 0), 0);

  const groups = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const list = groups.get(lead.source_channel) ?? [];
    list.push(lead);
    groups.set(lead.source_channel, list);
  }

  const bySource: SourceRow[] = [...groups.entries()]
    .map(([source, sourceLeads]) => {
      const ids = new Set(sourceLeads.map((lead) => lead.id));
      const sourceJobs = completedJobs.filter((job) => ids.has(job.lead_id));
      const sourceRevenue = sourceJobs.reduce(
        (total, job) => total + Number(job.completed_value ?? 0),
        0,
      );
      const sourceReplies = sourceLeads.filter((lead) => lead.first_reply_at).length;
      return {
        source,
        leads: sourceLeads.length,
        medianResponseMinutes: median(
          sourceLeads.map(responseMinutes).filter((value): value is number => value !== null),
        ),
        replyRate: sourceLeads.length ? sourceReplies / sourceLeads.length : 0,
        completedJobs: sourceJobs.length,
        completedRevenue: sourceRevenue,
        averageJobValue: sourceJobs.length ? sourceRevenue / sourceJobs.length : null,
        completedRate: sourceLeads.length ? sourceJobs.length / sourceLeads.length : 0,
      };
    })
    .sort((a, b) => b.leads - a.leads);

  const count = (statuses: string[]) => leads.filter((lead) => statuses.includes(lead.status)).length;
  const complete = leads.filter(
    (lead) => lead.vehicle_type && lead.main_concerns && lead.suburb,
  ).length;

  const needsFollowUp = (conversations ?? []).filter(
    (conversation) =>
      leadIds.has(conversation.lead_id) &&
      (conversation.status === "needs_attention" || conversation.next_follow_up_at !== null),
  ).length;

  return {
    totalLeads: leads.length,
    medianResponseMinutes: median(responseTimes),
    withinFiveMinutes: responseTimes.length
      ? responseTimes.filter((value) => value <= 5).length / responseTimes.length
      : 0,
    replyRate: leads.length ? replied / leads.length : 0,
    completedJobs: completedJobs.length,
    completedRevenue: revenue,
    averageJobValue: completedJobs.length ? revenue / completedJobs.length : null,
    needsFollowUp,
    optOuts: leads.filter((lead) => lead.opted_out_at).length,
    deliveryFailures: failures?.length ?? 0,
    formCompletionRate: leads.length ? complete / leads.length : 0,
    funnel: {
      enquiries: leads.length,
      contacted: leads.filter((lead) => lead.first_contacted_at).length,
      replied,
      quoteReady: count(["ready_for_quote"]),
      quoteSent: count(["quote_sent"]),
      scheduled: count(["scheduled"]),
      completed: completedJobs.length,
      lost: count(["lost"]),
    },
    bySource,
  };

}
