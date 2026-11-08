/**
 * Facebook ad performance: pure calculations shared by the server and tests.
 * Spend comes from Meta's Insights API (per campaign per day); leads, bookings
 * and completed-job revenue come from BookedSecure's own records, joined on the
 * campaign id each Facebook lead was attributed to.
 */
export type SpendRow = { campaign_id: string; campaign_name: string | null; date: string; spend: number; meta_leads: number };
export type LeadRow = { id: string; campaign_id: string | null; campaign_name: string | null };
export type JobRow = { lead_id: string; scheduled_at: string | null; completion_status: string | null; completed_value: number | null };

export type CampaignPerformance = {
  campaignId: string | null;
  campaignName: string;
  spend: number;
  leads: number;
  booked: number;
  completed: number;
  revenue: number;
  costPerLead: number | null;
  costPerBooked: number | null;
  costPerCompleted: number | null;
  roas: number | null;
};

const ratio = (spend: number, n: number) => (n > 0 && spend > 0 ? Math.round((spend / n) * 100) / 100 : null);
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * One row per campaign (plus "Not from a known campaign" for leads without
 * attribution), sorted by spend. A lead counts as booked once any job for it has
 * a scheduled time (and wasn't cancelled), and as completed when a job is
 * completed; revenue is the sum of completed job values.
 */
export function buildAdPerformance(spend: SpendRow[], leads: LeadRow[], jobs: JobRow[]): { campaigns: CampaignPerformance[]; total: CampaignPerformance } {
  const byLead = new Map<string, JobRow[]>();
  for (const j of jobs) { const list = byLead.get(j.lead_id) ?? []; list.push(j); byLead.set(j.lead_id, list); }
  const rows = new Map<string, CampaignPerformance>();
  const row = (id: string | null, name: string | null) => {
    const key = id ?? '__none__';
    let r = rows.get(key);
    if (!r) {
      r = { campaignId: id, campaignName: name || (id ? `Campaign ${id}` : 'Not from a known campaign'), spend: 0, leads: 0, booked: 0, completed: 0, revenue: 0, costPerLead: null, costPerBooked: null, costPerCompleted: null, roas: null };
      rows.set(key, r);
    } else if (name && r.campaignName.startsWith('Campaign ')) r.campaignName = name;
    return r;
  };
  for (const s of spend) row(s.campaign_id, s.campaign_name).spend += s.spend;
  for (const l of leads) {
    const r = row(l.campaign_id, l.campaign_name);
    r.leads += 1;
    const lj = byLead.get(l.id) ?? [];
    if (lj.some((j) => j.scheduled_at && j.completion_status !== 'cancelled')) r.booked += 1;
    const done = lj.filter((j) => j.completion_status === 'completed');
    if (done.length) r.completed += 1;
    r.revenue += done.reduce((sum, j) => sum + (Number(j.completed_value) || 0), 0);
  }
  const finish = (r: CampaignPerformance): CampaignPerformance => {
    const spendTotal = money(r.spend);
    return { ...r, spend: spendTotal, revenue: money(r.revenue), costPerLead: ratio(spendTotal, r.leads), costPerBooked: ratio(spendTotal, r.booked), costPerCompleted: ratio(spendTotal, r.completed), roas: spendTotal > 0 ? Math.round((r.revenue / spendTotal) * 100) / 100 : null };
  };
  const campaigns = [...rows.values()].map(finish).sort((a, b) => b.spend - a.spend || b.leads - a.leads);
  const total = finish(campaigns.reduce<CampaignPerformance>((t, c) => ({ ...t, spend: t.spend + c.spend, leads: t.leads + c.leads, booked: t.booked + c.booked, completed: t.completed + c.completed, revenue: t.revenue + c.revenue }),
    { campaignId: null, campaignName: 'All campaigns', spend: 0, leads: 0, booked: 0, completed: 0, revenue: 0, costPerLead: null, costPerBooked: null, costPerCompleted: null, roas: null }));
  return { campaigns, total };
}

/** Meta reports leads under several action types; count each lead once. */
export function metaLeadCount(actions: Array<{ action_type?: string | undefined; value?: string | number | undefined }> | undefined): number {
  if (!actions) return 0;
  const pick = actions.find((a) => a.action_type === 'lead') ?? actions.find((a) => a.action_type === 'onsite_conversion.lead_grouped');
  return pick ? Math.round(Number(pick.value) || 0) : 0;
}
