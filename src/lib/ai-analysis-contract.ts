// Structured-analysis contract for lead qualification.
//
// Pure, client-safe and unit-testable: the schema, safe normalisation of
// provider formatting quirks, redacted validation reporting, and the bounded
// repair instruction all live here. No secrets, no provider calls, no DB access.
import { z } from "zod";

export const READINESS_VALUES = [
  "new",
  "needs_information",
  "quote_ready",
  "high_intent",
  "unclear",
  "not_suitable",
] as const;

/**
 * The analysis contract. Unchanged in shape from Phase 3: every field is
 * required, optional values are explicitly `null` (never absent, never
 * `undefined`), so the schema stays strict-`json_schema` compatible and the
 * guardrails always receive a concrete value.
 *
 * `extracted.requested_day_or_time` is the customer's own words about timing.
 * It is required-but-nullable: the model must state `null` when the customer
 * gave no preference, and it is never turned into a server-approved slot.
 */
export const AnalysisSchema = z.object({
  summary: z.string(),
  readiness: z.enum(READINESS_VALUES),
  missing_fields: z.array(z.string()),
  extracted: z.object({
    vehicle_type: z.string().nullable(),
    suburb: z.string().nullable(),
    last_cleaned_at: z.string().nullable(),
    main_concerns: z.string().nullable(),
    service_intent: z.string().nullable(),
    requested_day_or_time: z.string().nullable(),
  }),
  suggested_reply: z.string(),
  needs_human_review: z.boolean(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

/** User-facing copy for a final analysis failure. Never mentions the provider. */
export const AI_ANALYSIS_FAILURE_MESSAGE =
  "AI analysis could not be completed. No message was sent. Please try again or review this lead manually.";

/**
 * The only normalisation applied to raw provider text: strip a Markdown code
 * fence around otherwise-valid JSON, a formatting quirk already handled
 * elsewhere in this repository. Nothing about the JSON itself is rewritten.
 */
export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

export type AnalysisParseResult =
  | { status: "ok"; analysis: Analysis }
  | { status: "unparseable"; reason: string }
  | { status: "invalid"; reason: string };

/**
 * Redacted issue description: field path plus expected/received *types* only.
 * Customer values and raw model text are never included.
 */
export function describeValidationIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.join(".") || "(root)";
    const detail = issue as { expected?: unknown; received?: unknown };
    const expected = typeof detail.expected === "string" ? detail.expected : issue.code;
    const received = typeof detail.received === "string" ? ` received ${detail.received}` : "";
    return `${path}: expected ${expected}${received}`;
  });
  const extra = error.issues.length > issues.length ? ` (+${error.issues.length - issues.length} more)` : "";
  return `schema_rejected: ${issues.join("; ")}${extra}`;
}

/**
 * Parses raw provider text against the existing schema. Distinguishes "no
 * parseable object at all" from "a valid object the schema rejected".
 */
export function parseAnalysisPayload(raw: string | null | undefined): AnalysisParseResult {
  const text = typeof raw === "string" ? stripJsonFences(raw) : "";
  if (text.length === 0) return { status: "unparseable", reason: "empty_response: provider returned no text" };

  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { status: "unparseable", reason: "unparseable_response: provider text was not valid JSON" };
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { status: "unparseable", reason: "unparseable_response: provider text was not a JSON object" };
  }

  const parsed = AnalysisSchema.safeParse(candidate);
  if (parsed.success) return { status: "ok", analysis: parsed.data };
  return { status: "invalid", reason: describeValidationIssues(parsed.error) };
}

/**
 * The one bounded repair instruction. States the exact expected field types and
 * repeats the guardrails; carries no secrets and no raw provider output.
 */
export function buildRepairInstruction(reason: string): string {
  return [
    "Your previous response could not be used.",
    `Validation problem: ${reason}`,
    "Return ONE JSON object only, with exactly these fields and types:",
    '- summary: string',
    `- readiness: string, one of ${READINESS_VALUES.join(" | ")}`,
    "- missing_fields: array of strings (use [] when nothing is missing)",
    "- extracted: object with vehicle_type, suburb, last_cleaned_at, main_concerns, service_intent, requested_day_or_time — each a string or null (never omitted, never a number, object or array)",
    "- suggested_reply: string",
    "- needs_human_review: boolean",
    "Keep every safety rule from the system instructions: no prices beyond the approved facts, no discounts, fees, dates, times, availability, booking claims or photo requests.",
  ].join("\n");
}

/** Short, non-secret correlation reference shown to the owner. */
export function correlationRef(correlationId: string): string {
  return correlationId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function failureMessage(reason: string, correlationId: string): string {
  return `${AI_ANALYSIS_FAILURE_MESSAGE} (reason: ${reason} · ref ${correlationRef(correlationId)})`;
}
