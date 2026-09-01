// Duplicate-enquiry contract shared by the public quote server function and the
// public form. Duplicate protection itself lives in captureLead: this module only
// describes how a duplicate is reported, so the client can never mistake a
// suppressed duplicate for a successful submission.

export const DUPLICATE_LEAD_CODE = "DUPLICATE_LEAD" as const;

/** Server-side message. Deliberately free of any stored customer detail. */
export const DUPLICATE_LEAD_MESSAGE =
  "This mobile number already has a recent or existing enquiry.";

/** Customer-facing copy, with the next step the person can actually take. */
export const DUPLICATE_LEAD_CLIENT_MESSAGE =
  "This mobile number already has a recent or existing enquiry. Please contact the business directly if you need to update it.";

export type QuoteDuplicateResponse = {
  ok: false;
  duplicate: true;
  code: typeof DUPLICATE_LEAD_CODE;
  message: string;
};

/** The only shape the server uses to report a suppressed duplicate. */
export function duplicateQuoteResponse(): QuoteDuplicateResponse {
  return {
    ok: false,
    duplicate: true,
    code: DUPLICATE_LEAD_CODE,
    message: DUPLICATE_LEAD_MESSAGE,
  };
}

export type QuoteOutcome = "success" | "duplicate" | "error";

/**
 * Classifies a submission response. A duplicate is never `success`, and an
 * ordinary validation failure is never `duplicate`.
 */
export function classifyQuoteResult(result: unknown): QuoteOutcome {
  if (!result || typeof result !== "object") return "error";
  const record = result as Record<string, unknown>;
  if (record["duplicate"] === true || record["code"] === DUPLICATE_LEAD_CODE) return "duplicate";
  return record["ok"] === true ? "success" : "error";
}

export function isDuplicateQuoteResult(result: unknown): boolean {
  return classifyQuoteResult(result) === "duplicate";
}

/** Message to render for a non-success response. Never returns an empty string. */
export function quoteErrorMessage(result: unknown): string {
  if (classifyQuoteResult(result) === "duplicate") return DUPLICATE_LEAD_CLIENT_MESSAGE;
  const record = (result ?? {}) as Record<string, unknown>;
  const error = record["error"];
  return typeof error === "string" && error.trim().length > 0
    ? error
    : "Something went wrong. Please try again or call us.";
}
