import { describe, expect, it } from 'vitest';
import { buildAdPerformance, metaLeadCount } from './meta-ads';

describe('Facebook ad performance', () => {
  const spend = [
    { campaign_id: 'c1', campaign_name: 'Bentley interior', date: '2026-11-01', spend: 60, meta_leads: 3 },
    { campaign_id: 'c1', campaign_name: 'Bentley interior', date: '2026-11-02', spend: 40.5, meta_leads: 2 },
    { campaign_id: 'c2', campaign_name: 'Reviews carousel', date: '2026-11-02', spend: 20, meta_leads: 0 },
  ];
  const leads = [
    { id: 'l1', campaign_id: 'c1', campaign_name: 'Bentley interior' },
    { id: 'l2', campaign_id: 'c1', campaign_name: 'Bentley interior' },
    { id: 'l3', campaign_id: null, campaign_name: null },
  ];
  const jobs = [
    { lead_id: 'l1', scheduled_at: '2026-11-03T01:00:00Z', completion_status: 'completed', completed_value: 280 },
    { lead_id: 'l2', scheduled_at: '2026-11-04T01:00:00Z', completion_status: 'scheduled', completed_value: null },
    { lead_id: 'l3', scheduled_at: '2026-11-04T01:00:00Z', completion_status: 'cancelled', completed_value: null },
  ];
  const { campaigns, total } = buildAdPerformance(spend, leads, jobs);

  it('adds spend per campaign and joins leads, bookings and completed jobs', () => {
    const c1 = campaigns.find((c) => c.campaignId === 'c1')!;
    expect(c1).toMatchObject({ campaignName: 'Bentley interior', spend: 100.5, leads: 2, booked: 2, completed: 1, revenue: 280, costPerLead: 50.25, costPerBooked: 50.25, costPerCompleted: 100.5, roas: 2.79 });
  });
  it('shows campaigns with spend but no leads, and leads with no campaign', () => {
    expect(campaigns.find((c) => c.campaignId === 'c2')).toMatchObject({ spend: 20, leads: 0, costPerLead: null });
    expect(campaigns.find((c) => c.campaignId === null)).toMatchObject({ campaignName: 'Not from a known campaign', leads: 1, booked: 0, spend: 0, roas: null });
  });
  it('totals every campaign and sorts by spend', () => {
    expect(campaigns.map((c) => c.campaignId)).toEqual(['c1', 'c2', null]);
    expect(total).toMatchObject({ spend: 120.5, leads: 3, booked: 2, completed: 1, revenue: 280, costPerLead: 40.17, costPerCompleted: 120.5 });
  });
  it('does not count cancelled jobs as bookings', () => {
    expect(buildAdPerformance([], [leads[2]!], [jobs[2]!]).total.booked).toBe(0);
  });
  it('counts Meta-reported leads once', () => {
    expect(metaLeadCount([{ action_type: 'onsite_conversion.lead_grouped', value: '4' }, { action_type: 'lead', value: '4' }])).toBe(4);
    expect(metaLeadCount([{ action_type: 'link_click', value: '9' }])).toBe(0);
    expect(metaLeadCount(undefined)).toBe(0);
  });
});
