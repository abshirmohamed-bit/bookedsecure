import { describe, expect, it } from 'vitest';
import { campaignNeedsClarification } from './assistant-request-guard';

describe('Unspecified campaign requests', () => {
  it.each(['Create an email campaign', 'Please draft a campaign', 'Can you create an SMS campaign for me?'])('requires clarification for %s', (request) => {
    expect(campaignNeedsClarification(request)).toBe(true);
  });
  it('does not override an explicit all-existing-leads request', () => {
    expect(campaignNeedsClarification('Draft a campaign for all existing leads whether contacted or not, offering 15% off')).toBe(false);
  });
});