/**
 * Who is really waiting for the owner's reply. A customer's text marks the
 * conversation "needs_attention", but older conversations kept that flag after
 * the owner answered, booked them or closed them, so Home listed people who
 * no longer needed anything. A lead needs a reply only while the flag is set,
 * their latest text is newer than our latest text, and the lead is still open.
 */
export const NEEDS_REPLY_COLUMNS = "id, name, status, conversation_status, last_reply_at, last_outbound_sms_at" as const;

/** Statuses where there is nothing left to answer: booked, done or closed. */
const SETTLED_STATUSES = new Set(["scheduled", "completed", "lost", "opted_out", "invalid"]);

export type NeedsReplyRow = {
  status?: string | null;
  conversation_status?: string | null;
  last_reply_at?: string | null;
  last_outbound_sms_at?: string | null;
};

export function needsReply(row: NeedsReplyRow): boolean {
  if (row.conversation_status !== "needs_attention") return false;
  if (row.status && SETTLED_STATUSES.has(row.status)) return false;
  if (row.last_reply_at && row.last_outbound_sms_at) {
    return new Date(row.last_reply_at).getTime() > new Date(row.last_outbound_sms_at).getTime();
  }
  return true;
}
