/** Owner corrections take precedence over a model-selected campaign audience. */
export function requestsAllCampaignLeads(request: string): boolean {
  return /\b(?:all|every)\s+(?:(?:\d+|my|our|the|existing|current|eligible|consented)\s+)*(?:leads?|customers?|contacts?|clients?)\b/i.test(request) ||
    /\b(?:whether|wether)\s+contacted\s+or\s+not\b/i.test(request) ||
    /\b(?:all\s+of\s+them|everyone|everybody|the\s+whole\s+list)\b/i.test(request);
}

export function campaignContactBlock(lead: {
  mobile_number?: string | null;
  opted_out_at?: string | null;
  sms_suppressed_at?: string | null;
  deleted_at?: string | null;
  status?: string | null;
  consent_status?: string | null;
  consent_record?: unknown;
}): string | null {
  if (lead.deleted_at) return 'Lead is deleted.';
  const record = lead.consent_record && typeof lead.consent_record === 'object'
    ? lead.consent_record as Record<string, unknown> : {};
  if (lead.opted_out_at || lead.status === 'opted_out' || lead.consent_status === 'opted_out' || record['opted_out'] === true)
    return 'Lead has opted out.';
  if (lead.sms_suppressed_at) return 'Number is suppressed.';
  if (lead.status === 'invalid' || !/^\+614\d{8}$/.test(lead.mobile_number ?? '')) return 'No usable Australian mobile.';
  // Unknown consent is NOT proof of permission. Existing owner attestation is
  // still required by checkApproval before sending any campaign.
  return null;
}