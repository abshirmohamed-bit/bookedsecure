// Client-safe feedback constants shared by the tenant dialog and admin queue.

export const FEEDBACK_KINDS = ["feature_request", "issue_report"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  feature_request: "Request a feature/tool",
  issue_report: "Report an error/issue",
};

export const FEEDBACK_KIND_HINTS: Record<FeedbackKind, string> = {
  feature_request: "What would you like BookedSecure to do for you?",
  issue_report: "What went wrong, and what were you doing at the time?",
};

export const FEEDBACK_STATUSES = ["new", "seen", "in_progress", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  seen: "Seen",
  in_progress: "In progress",
  closed: "Closed",
};
