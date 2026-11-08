import { describe, expect, it } from 'vitest';
import { checkLead, computeSince, enrichmentPatch, finalRunStatus, humanizeAnswer, mapEnquiryFields, mapLeadFields, metaExternalId } from './lead-sync';

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
  it('never reports a run with failed leads as done', () => {
    expect(finalRunStatus(0, null)).toBe('completed');
    expect(finalRunStatus(2, null)).toBe('partial');
  });
});

describe('whole-enquiry mapping', () => {
  const glocastForm = { meta_lead_id: '1', field_data: [
    { name: 'full_name', values: ['Charlie Baissari'] },
    { name: 'phone_number', values: ['+61400000020'] },
    { name: "the_type_of_detail_i'm_looking_for_is", values: ['Full Detail'] },
    { name: 'how_soon_are_you_wanting_this_done', values: ['ASAP'] },
    { name: 'are_you_comfortable_with_our_starting_prices', values: ['Yes'] },
    { name: 'suburb', values: ['Penrith'] },
  ] };

  it('maps Glocast’s real form questions onto the structured fields', () => {
    const m = mapEnquiryFields(glocastForm);
    expect(m.service).toBe('Full Detail');
    expect(m.timing).toBe('ASAP');
    expect(m.pricing).toBe('Yes');
    expect(m.suburb).toBe('Penrith');
    expect(m.requestType).toBe('service');
    expect(m.flexibleText).toContain('Service: Full Detail');
    expect(m.flexibleText).toContain('Timing: ASAP');
  });

  it('keeps every question verbatim, including unmapped ones', () => {
    const m = mapEnquiryFields({ meta_lead_id: '1', field_data: [
      { name: 'full_name', values: ['Sam'] },
      { name: 'some_custom_question', values: ['Custom answer'] },
    ] });
    expect(m.rawAnswers).toEqual([
      { name: 'full_name', values: ['Sam'] },
      { name: 'some_custom_question', values: ['Custom answer'] },
    ]);
  });

  it('is a quote enquiry when no service is named, never a booking', () => {
    const m = mapEnquiryFields({ meta_lead_id: '1', field_data: [{ name: 'full_name', values: ['Sam'] }] });
    expect(m.requestType).toBe('quote');
  });

  it('drops Meta dummy placeholder answers from the enquiry', () => {
    const m = mapEnquiryFields({ meta_lead_id: '1', field_data: [
      { name: 'full_name', values: ['<test lead: dummy data for full_name>'] },
    ] });
    expect(m.rawAnswers).toEqual([]);
  });
});

describe('safe re-import enrichment', () => {
  const mapped = mapEnquiryFields({ meta_lead_id: '1', field_data: [
    { name: "the_type_of_detail_i'm_looking_for_is", values: ['Full Detail'] },
    { name: 'suburb', values: ['Penrith'] },
  ] });

  it('fills only empty fields and never overwrites recorded values', () => {
    const { patch, changed } = enrichmentPatch(
      { email: null, suburb: 'Glenmore Park', service_intent: null, request_type: null, source_metadata: null },
      mapped,
      { email: 'c@example.com' },
    );
    expect(patch['email']).toBe('c@example.com');
    expect(patch['service_intent']).toBe('Full Detail');
    expect(patch['suburb']).toBeUndefined();
    expect(changed).toContain('email');
    expect(changed).not.toContain('suburb');
  });

  it('never touches lifecycle or booking state', () => {
    const { patch } = enrichmentPatch({}, mapped, { email: null });
    for (const key of Object.keys(patch)) {
      expect(['status', 'booking_status', 'quote_status', 'name', 'mobile_number']).not.toContain(key);
    }
  });

  it('merges form answers without duplicating a stored question', () => {
    const existing = { source_metadata: { form_answers: [{ name: 'suburb', values: ['Penrith'] }] } };
    const { patch } = enrichmentPatch(existing, mapped, { email: null });
    const answers = (patch['source_metadata'] as { form_answers: { name: string }[] }).form_answers;
    expect(answers.map((a) => a.name)).toEqual(['suburb', "the_type_of_detail_i'm_looking_for_is"]);
  });

  it('reports no change when there is nothing new to add', () => {
    const existing = {
      email: 'c@example.com', suburb: 'Penrith', service_intent: 'Full Detail', request_type: 'service',
      service_name_snapshot: 'Full Detail', flexible_request_text: 'Service: Full Detail',
      source_metadata: { form_answers: mapped.rawAnswers },
    };
    const { changed } = enrichmentPatch(existing, mapped, { email: 'c@example.com' });
    expect(changed).toEqual([]);
  });
  it('shows Facebook option keys as words, leaving typed answers alone', () => {
    expect(humanizeAnswer('full_detail_(starting_$280)')).toBe('Full detail (starting $280)');
    expect(humanizeAnswer("yes,_i'd_like_a_quote")).toBe("Yes, i'd like a quote");
    expect(humanizeAnswer('within_the_next_2_weeks_')).toBe('Within the next 2 weeks');
    expect(humanizeAnswer('john_smith@gmail.com')).toBe('john_smith@gmail.com');
    expect(humanizeAnswer('Interior and exterior_please')).toBe('Interior and exterior_please');
    expect(humanizeAnswer('https://x.com/a_b')).toBe('https://x.com/a_b');
    const m = mapEnquiryFields({ meta_lead_id: '9', field_data: [{ name: "the_type_of_detail_i'm_looking_for_is", values: ['full_detail_(starting_$280)'] }] });
    expect(m.service).toBe('Full detail (starting $280)');
    expect(m.rawAnswers[0]?.values).toEqual(['Full detail (starting $280)']);
  });
});
