import { describe, expect, it } from 'vitest';
import { conversationContext, interruptedAssistantResult } from './assistant-context';

describe('Cowork task context', () => {
  it('keeps the first instruction beyond twelve turns', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: `Request ${i}` }));
    const context = conversationContext(turns);
    expect(context).toHaveLength(30);
    expect(context[0]?.text).toBe('Request 0');
  });
  it('keeps completed approval outcome even when the reply has no text', () => {
    const context = conversationContext([{ role: 'assistant', text: '', done: 'Sent the confirmed message.', proposals: [] }]);
    expect(context[0]?.text).toContain('Recorded completion: Sent the confirmed message.');
  });
  it('does not treat an unconfirmed proposal as sent', () => {
    const context = conversationContext([{ role: 'assistant', text: 'Ready.', done: null, proposals: [{ kind: 'send_text' }] }]);
    expect(context[0]?.text).toContain('not evidence that it was confirmed or sent');
  });
  it('retains saved changes and proposals after interruption', () => {
    const result = interruptedAssistantResult(['Booked Sam.'], [{ kind: 'send_text' }]);
    expect(result.executed).toEqual(['Booked Sam.']);
    expect(result.proposals).toEqual([{ kind: 'send_text' }]);
  });
});