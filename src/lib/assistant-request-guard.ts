/** Vague campaign creation is not authorisation to select recipients or an offer. */
export function campaignNeedsClarification(request: string, hasEarlierContext = false): boolean {
  // "Draft the campaign" after the owner gave details (earlier turns or a file) continues that task;
  // the model resolves those details and the campaign tools still enforce the audience rules.
  if (hasEarlierContext) return false;
  const words = request.toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(?:please|can|could|would|will|you|i|want|need|to|for|me|us|lets|a|an|the|new|create|make|prepare|draft|set|up|email|sms|text|marketing|campaign)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  return /\bcampaign\b/i.test(request) && words.length === 0;
}

export const CAMPAIGN_CLARIFICATION =
  'Who should this campaign go to, and what should it say or offer? No campaign has been saved and nothing has been sent.';

/** True when earlier turns or a file can supply the campaign details a short follow-up refers to. */
export function campaignContextAvailable(input: { history?: Array<{ role: string; text: string }>; attachment?: unknown }): boolean {
  if (input.attachment) return true;
  return (input.history ?? []).slice(-6).some((turn) => /\b(?:campaign|offer|discount|promo|leads?|customers?|%|percent)\b/i.test(turn.text));
}
