import { describe, expect, it } from 'vitest';
import { buildFacebookReply, classifyFacebookAnswers, formatAuPhone, isSameCustomer, parseExactDateTime } from './facebook-lead-response';

const now = new Date('2026-11-08T00:00:00Z');
const tz = 'Australia/Sydney';
const base = { firstName: 'Sam', businessName: 'Acme Detailing', phone: '0447 852 565', quoteUrl: 'https://bookedsecure.com/quote/acme', returning: false, service: null, bookedLabel: null };

describe('Facebook lead auto-response', () => {
  it('treats vague answers as a quote request', () => {
    expect(classifyFacebookAnswers([{ name: 'how_soon', values: ['ASAP'] }], tz, now)).toEqual({ intent: 'quote', requestedAt: null });
  });
  it('books only with an exact future date and time', () => {
    expect(parseExactDateTime('12/11/2026 9:30am', tz, now)).toBe('2026-11-11T22:30:00.000Z');
    expect(parseExactDateTime('next Tuesday morning', tz, now)).toBeNull();
    expect(parseExactDateTime('12/11/2026', tz, now)).toBeNull();
    expect(parseExactDateTime('01/11/2026 9:30am', tz, now)).toBeNull();
  });
  it('quote reply includes business phone, quote link and opt-out', () => {
    const r = buildFacebookReply({ ...base, intent: 'quote' })!;
    expect(r).toContain('0447 852 565');
    expect(r).toContain('https://bookedsecure.com/quote/acme');
    expect(r).toContain('STOP');
  });
  it('returning customers get a welcome-back reply', () => {
    expect(buildFacebookReply({ ...base, intent: 'quote', returning: true })).toContain('welcome back');
  });
  it('sends nothing without a phone or quote link', () => {
    expect(buildFacebookReply({ ...base, phone: null, quoteUrl: null, intent: 'quote' })).toBeNull();
  });
  it('returning match needs mobile, name and email', () => {
    const a = { mobile: '+61400000000', name: 'Sam Lee', email: 'sam@x.com' };
    expect(isSameCustomer(a, { ...a, name: ' sam  lee', email: 'SAM@x.com' })).toBe(true);
    expect(isSameCustomer(a, { ...a, email: 'other@x.com' })).toBe(false);
    expect(isSameCustomer({ ...a, email: null }, { ...a, email: null })).toBe(false);
  });
  it('formats Australian numbers', () => {
    expect(formatAuPhone('+61447852565')).toBe('0447 852 565');
  });
});
