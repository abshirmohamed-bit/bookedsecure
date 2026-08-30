// Pure composition of the Lead Inbox rows.
//
// A conversation is optional: imported historical leads have no conversation
// and no messages yet, and must still appear in the inbox.

export type InboxLead = { id: string; created_at: string } & Record<string, unknown>;
export type InboxConversation = { lead_id: string } & Record<string, unknown>;
export type InboxJob = { lead_id: string } & Record<string, unknown>;

export type InboxRow<L extends InboxLead, C extends InboxConversation, J extends InboxJob> = L & {
  conversation: C | null;
  job: J | null;
};

/**
 * Left-joins conversations and jobs onto leads. Leads without either are kept,
 * with `conversation: null` / `job: null`.
 */
export function composeInboxRows<
  L extends InboxLead,
  C extends InboxConversation,
  J extends InboxJob,
>(leads: L[] | null | undefined, conversations: C[] | null | undefined, jobs: J[] | null | undefined) {
  const conversationByLead = new Map((conversations ?? []).map((row) => [row.lead_id, row]));
  const jobByLead = new Map((jobs ?? []).map((row) => [row.lead_id, row]));
  return (leads ?? []).map((lead) => ({
    ...lead,
    conversation: conversationByLead.get(lead.id) ?? null,
    job: jobByLead.get(lead.id) ?? null,
  })) as InboxRow<L, C, J>[];
}

/** Timestamp the inbox sorts/labels by: last message when present, else creation. */
export function inboxLastActivity(row: {
  created_at: string;
  conversation: { last_message_at?: unknown } | null;
}): string {
  const last = row.conversation?.last_message_at;
  return typeof last === "string" && last ? last : row.created_at;
}
