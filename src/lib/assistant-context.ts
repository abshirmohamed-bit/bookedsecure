export type ConversationTurn = {
  role: 'user' | 'assistant';
  text: string;
  done?: string | null;
  proposals?: unknown[];
};

/** Preserve the whole authorised thread, including approval outcomes. */
export function conversationContext(turns: readonly ConversationTurn[]) {
  return turns.map((turn) => ({
    role: turn.role,
    text: [
      turn.text,
      turn.role === 'assistant' && turn.done ? `Recorded completion: ${turn.done}` : '',
      turn.role === 'assistant' && !turn.done && turn.proposals?.length
        ? 'Approval state: a proposal was prepared; this is not evidence that it was confirmed or sent.'
        : '',
    ].filter(Boolean).join('\n'),
  })).filter((turn) => turn.text.trim().length > 0);
}

/** Never replay an interrupted turn once a tool may have changed records. */
export function interruptedAssistantResult<T>(executed: string[], proposals: T[]) {
  return {
    answer: [
      'The assistant stopped before finishing your request.',
      executed.length ? `Completed: ${executed.join(' ')}` : 'No completed changes were recorded; check your records before retrying.',
      proposals.length ? 'Prepared items still need your confirmation below; nothing was sent by those proposals.' : '',
      'The request was not automatically run again.',
    ].filter(Boolean).join(' '),
    executed,
    proposals,
  };
}