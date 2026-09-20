/**
 * Repeat guard for the public quote conversation.
 *
 * PURE module. It records how many times each question has actually been put to
 * the customer and decides what to do when the same detail comes round again:
 * ask once more with a concrete example, then either let an optional detail go
 * or leave it for the team — never rephrase the same question forever.
 *
 * Nothing here books, prices, messages or invents a value. The only state it
 * writes is the per-step ask counter and, for an optional detail the customer
 * has clearly not given, an explicit "left for the team" marker.
 */

import type { WebChatCollected, WebChatStep } from "@/lib/web-chat";

/** Details the conversation can proceed without. */
export const OPTIONAL_COLLECTION_STEPS = ["address", "concerns"] as const;

/** Value stored when an optional detail is let go rather than asked again. */
export const LEFT_FOR_TEAM = "Not provided — to confirm with the customer";

/** Asks allowed per detail before it is let go or handed to the team. */
export const MAX_ASKS_PER_FIELD = 3;

export function askCount(collected: WebChatCollected, step: string): number {
  const log = collected.asked ?? null;
  const value = log ? log[step] : 0;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Records that this question was put to the customer on this turn. */
export function recordAsk(collected: WebChatCollected, step: string): WebChatCollected {
  return { ...collected, asked: { ...(collected.asked ?? {}), [step]: askCount(collected, step) + 1 } };
}

export function isOptionalStep(step: string): boolean {
  return (OPTIONAL_COLLECTION_STEPS as readonly string[]).includes(step);
}

/**
 * True once an optional detail has been asked enough times: the customer has
 * had a fair chance and is clearly not giving it here.
 */
export function shouldLetGo(collected: WebChatCollected, step: string): boolean {
  return isOptionalStep(step) && askCount(collected, step) >= MAX_ASKS_PER_FIELD - 1;
}

/** Stores the "left for the team" marker for an optional detail. */
export function letGo(collected: WebChatCollected, step: string): WebChatCollected {
  if (step === "address") return { ...collected, service_address: LEFT_FOR_TEAM };
  if (step === "concerns") return { ...collected, concerns: LEFT_FOR_TEAM };
  return collected;
}

/** A concrete example added the SECOND time a detail is asked for. */
const EXAMPLES: Partial<Record<string, string>> = {
  vehicle: "for example “2019 Toyota Camry”",
  suburb: "for example “12 Smith St, Auburn”",
  address: "for example “12 Smith St”",
  name: "for example “Sam, 0412 345 678”",
  mobile: "for example “0412 345 678”",
  concerns: "for example “pet hair in the back seats”",
};

/**
 * The wording for asking a detail again. First ask: the normal question. Second:
 * the same question plus an example. Optional details also offer a way out, so
 * the customer is never cornered by a question they do not want to answer.
 */
export function escalatedAsk(step: string, base: string, count: number): string {
  if (count <= 0) return base;
  const example = EXAMPLES[step];
  const parts = [base.replace(/\s+$/, "")];
  if (example && !base.includes(example)) parts.push(`— ${example}`);
  if (isOptionalStep(step) && !base.includes("Or say “skip”")) {
    parts.push("Or say “skip” and we'll sort it with you directly.");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The line used when an optional detail is let go instead of asked again. */
export function letGoMessage(step: string): string {
  return step === "address"
    ? "No worries, we'll confirm the exact address with you directly."
    : "No worries, we'll go through the details with you directly.";
}

/**
 * Advances past any optional detail that has already been asked its limit,
 * so the conversation moves on instead of circling the same question.
 */
export function advancePastRepeats(
  collected: WebChatCollected,
  nextStep: (state: WebChatCollected) => WebChatStep | null,
): { collected: WebChatCollected; step: WebChatStep | null; letGoSteps: string[] } {
  let state = collected;
  const letGoSteps: string[] = [];
  for (let guard = 0; guard < OPTIONAL_COLLECTION_STEPS.length + 1; guard += 1) {
    const step = nextStep(state);
    if (!step || !isOptionalStep(step) || askCount(state, step) < MAX_ASKS_PER_FIELD) {
      return { collected: state, step, letGoSteps };
    }
    state = letGo(state, step);
    letGoSteps.push(step);
  }
  return { collected: state, step: nextStep(state), letGoSteps };
}

/** What the model is told about questions already put to this customer. */
export function askHistoryForPrompt(collected: WebChatCollected): string {
  const log = collected.asked ?? {};
  const entries = Object.entries(log).filter(([, count]) => typeof count === "number" && count > 0);
  if (entries.length === 0) return "(nothing asked yet)";
  return entries.map(([step, count]) => `${step}: asked ${count}x`).join(", ");
}
