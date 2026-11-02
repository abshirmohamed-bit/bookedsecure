import { describe, expect, it } from 'vitest';
import { requestsAllCampaignLeads } from './campaign-audience';
import { campaignContextAvailable, campaignNeedsClarification } from './assistant-request-guard';

describe('campaign follow-ups and narrowed audiences', () => {
  it('lets "Draft the campaign" continue details given earlier', () => {
    const history = [{ role: 'assistant', text: 'Want me to draft it for all 382 leads at 15% off?' }];
    expect(campaignNeedsClarification('Draft the campaign', campaignContextAvailable({ history }))).toBe(false);
  });
  it('lets an attached file supply the audience', () => {
    expect(campaignNeedsClarification('Create the campaign', campaignContextAvailable({ attachment: { filename: 'a.csv' } }))).toBe(false);
  });
  it('still asks when nothing was given', () => {
    expect(campaignNeedsClarification('Create the campaign', campaignContextAvailable({ history: [] }))).toBe(true);
  });
  it('does not widen narrowed requests', () => {
    expect(requestsAllCampaignLeads("Draft a 10% offer for all leads that haven't been contacted yet")).toBe(false);
    expect(requestsAllCampaignLeads('text all customers with status new')).toBe(false);
    expect(requestsAllCampaignLeads("everyone who hasn't booked in 6 months")).toBe(false);
  });
  it('still honours real all-leads requests', () => {
    expect(requestsAllCampaignLeads('All 382 leads please')).toBe(true);
    expect(requestsAllCampaignLeads('all existing leads whether contacted or not')).toBe(true);
    expect(requestsAllCampaignLeads('everyone')).toBe(true);
  });
});
