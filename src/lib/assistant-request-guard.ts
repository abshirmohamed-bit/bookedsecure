/** Vague campaign creation is not authorisation to select recipients or an offer. */
export function campaignNeedsClarification(request: string): boolean {
  const words = request.toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(?:please|can|could|would|will|you|i|want|need|to|me|us|lets|a|an|the|new|create|make|prepare|draft|set|up|email|sms|text|marketing|campaign)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  return /\bcampaign\b/i.test(request) && words.length === 0;
}

export const CAMPAIGN_CLARIFICATION =
  'Who should this campaign go to, and what should it say or offer? No campaign has been saved and nothing has been sent.';