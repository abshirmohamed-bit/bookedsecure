import { describe, expect, it } from 'vitest';
import { checkLead, computeSince, finalRunStatus, isAllowedTriggerUrl, mapLeadFields, metaExternalId } from './lead-sync';

describe('facebook lead sync rules', () => {
  it('takes the first value of each Meta field', () => {
    const m = mapLeadFields({ meta_lead_id: '1', field_data: [
      { name: 'full_name', values: ['Charlie Baissari', 'x'] }, { name: 'phone_number', values: ['+61400000020'] }, { name: 'email', values: ['c@example.com'] },
    ] });
    expect(m).toEqual({ name: 'Charlie Baissari', mobile: '+61400000020', email: 'c@example.com' });
  });
  it('joins first and last name when the form splits them', () => {
    expect(mapLeadFields({ meta_lead_id: '1', field_data: [{ name: 'First Name', values: ['Ana'] }, { name: 'last_name', values: ['Lee'] }] }).name).toBe('Ana Lee');
  });
  it('skips Meta dummy test leads', () => {
    const r = checkLead({ meta_lead_id: '1', field_data: [{ name: 'full_name', values: ['<test lead: dummy data for full_name>'] }, { name: 'phone_number', values: ['<test lead: dummy data for phone_number>'] }] });
    expect(r).toEqual({ ok: false, reason: 'Meta test lead (dummy data).' });
  });
  it('flags a lead with no phone instead of saving it', () => {
    expect(checkLead({ meta_lead_id: '1', name: 'Sam' }).ok).toBe(false);
  });
  it('keeps the agreed external id format', () => {
    expect(metaExternalId('1883632116169659')).toBe('facebook-lead:1883632116169659');
  });
  it('re-reads 15 minutes before a form checkpoint', () => {
    expect(computeSince('2026-11-04T10:00:00.000Z', 7).toISOString()).toBe('2026-11-04T09:45:00.000Z');
  });
  it('first import uses the chosen lookback', () => {
    expect(computeSince(null, 7, new Date('2026-11-08T00:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
  it('only calls Make webhook addresses', () => {
    expect(isAllowedTriggerUrl('https://hook.eu2.make.com/abc123xyz789')).toBe(true);
    expect(isAllowedTriggerUrl('https://evil.example.com/hook.eu2.make.com')).toBe(false);
    expect(isAllowedTriggerUrl('http://hook.eu2.make.com/abc123xyz789')).toBe(false);
  });
  it('never reports a run with failed leads as done', () => {
    expect(finalRunStatus(0, null)).toBe('completed');
    expect(finalRunStatus(2, null)).toBe('partial');
  });
});
