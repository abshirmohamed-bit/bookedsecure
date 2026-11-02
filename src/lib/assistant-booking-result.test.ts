import { describe, expect, it } from 'vitest';
import { bookingOutcomeSummary, customerSearchPatterns } from './assistant-booking-result';

describe('booking outcome summary', () => {
  it('reports a saved booking as saved with time, service and status', () => {
    const text = bookingOutcomeSummary({ ok: true, saved: true, outcome: 'created_booking', scheduledAt: '2026-11-01T01:30:00Z', serviceName: 'Full Detail', status: 'scheduled', changed: 1 }, 'Australia/Sydney');
    expect(text).toMatch(/^Saved a new booking/);
    expect(text).toContain('Full Detail');
    expect(text).toContain('12:30');
  });
  it('says a same-time booking for the same customer was updated, not refused', () => {
    expect(bookingOutcomeSummary({ ok: true, saved: true, outcome: 'updated_existing_booking', scheduledAt: '2026-11-02T00:00:00Z', serviceName: 'Full Detail', status: 'scheduled' }, 'Australia/Sydney')).toMatch(/^Updated this customer's existing booking/);
  });
  it('never claims success without a saved booking', () => {
    expect(bookingOutcomeSummary({ ok: true }, 'Australia/Sydney')).toMatch(/no saved booking/);
  });
});

describe('customer search by phone', () => {
  it.each(['0403 392 447', '+61 403 392 447', '61403392447', '0403-392-447'])('finds a mobile typed as %s', q => {
    expect(customerSearchPatterns(q).mobile).toBe('61403392447');
  });
  it('leaves name searches alone', () => {
    expect(customerSearchPatterns('Rhys').mobile).toBeNull();
  });
});
