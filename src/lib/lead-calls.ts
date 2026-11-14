/**
 * The AI Caller's rules (no database here): what a call can fill in on a lead,
 * how a pasted transcript is read, and how captured values are checked.
 *
 * Only real `leads` columns are captured (plus a preferred time, which is not
 * a lead field: a time becomes a booking, proposed through Co-Work so the
 * usual booking checks and confirmations apply).
 */
import { z } from "zod";
import { READINESS_VALUES } from "@/lib/ai-analysis-contract";
import { normaliseAuMobile } from "@/lib/domain";

export type CallLine = { role: "agent" | "prospect" | "note"; text: string; at_ms?: number };

/** The lead columns a call fills, in the order the profile shows them. */
export const CAPTURE_KEYS = [
  "name", "mobile_number", "email", "suburb", "service_address",
  "vehicle_type", "service_intent", "main_concerns", "readiness_classification",
] as const;
export type CaptureKey = (typeof CAPTURE_KEYS)[number];
export type Captured = Partial<Record<CaptureKey | "preferred_time", string>>;

export const READINESS_LABEL: Record<(typeof READINESS_VALUES)[number], string> = {
  new: "New", needs_information: "Needs information", quote_ready: "Ready for a quote",
  high_intent: "High intent", unclear: "Unclear", not_suitable: "Not suitable",
};

/** Labels for the profile form; the subject column is named for the business (a pool, a pet, a vehicle). */
export function captureLabels(subjectLabel = "Job"): Record<CaptureKey | "preferred_time", string> {
  return {
    name: "Name", mobile_number: "Mobile", email: "Email", suburb: "Suburb", service_address: "Address",
    vehicle_type: subjectLabel, service_intent: "Service", main_concerns: "What they need",
    readiness_classification: "Lead readiness", preferred_time: "Preferred time",
  };
}

const text = (max: number) => z.string().trim().max(max);

/** A captured payload, checked: real columns only, sensible lengths, a known readiness, an Australian mobile. */
export const capturedSchema = z.object({
  name: text(120).optional(),
  mobile_number: text(20).optional(),
  email: text(200).optional(),
  suburb: text(80).optional(),
  service_address: text(240).optional(),
  vehicle_type: text(120).optional(),
  service_intent: text(240).optional(),
  main_concerns: text(1000).optional(),
  readiness_classification: z.enum(READINESS_VALUES).optional(),
  preferred_time: text(120).optional(),
});

/** Whatever a model or a form sent, reduced to valid captured values (empty and invalid ones dropped). */
export function readCaptured(raw: unknown): Captured {
  if (!raw || typeof raw !== "object") return {};
  const out: Captured = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    const one = capturedSchema.safeParse({ [key]: typeof value === "string" ? value : String(value) });
    if (!one.success) continue;
    const v = (one.data as Record<string, string | undefined>)[key];
    if (typeof v === "string" && v.trim()) (out as Record<string, string>)[key] = v.trim();
  }
  if (out.mobile_number) {
    const mobile = normaliseAuMobile(out.mobile_number);
    if (mobile) out.mobile_number = mobile;
    else delete out.mobile_number;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) delete out.email;
  return out;
}

const AGENT = /^(me|i|us|we|owner|agent|ai|ai agent|business|staff|caller|rep)$/i;

/**
 * A pasted transcript or notes, as lines. "Me:" / "Agent:" (or the business's
 * own name) is the business side, "Customer:" / a person's name is the
 * prospect, and anything without a speaker is a note.
 */
export function parseTranscript(raw: string, businessName = ""): CallLine[] {
  const lines: CallLine[] = [];
  const own = businessName.trim().toLowerCase();
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = /^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/.exec(t);
    const body = m ? t.slice(m[0].length) : t;
    const speaker = /^([A-Za-z][A-Za-z .'()-]{0,30}):\s+(.+)$/.exec(body);
    if (!speaker) {
      const prev = lines[lines.length - 1];
      if (prev && prev.role !== "note" && !/^[-*•]/.test(body)) prev.text = `${prev.text} ${body}`.slice(0, 2000);
      else lines.push({ role: "note", text: body.replace(/^[-*•]\s*/, "").slice(0, 2000) });
      continue;
    }
    const who = speaker[1]!.trim();
    // The business side by its usual words or its own name; anyone else (a name, "Customer") is the prospect.
    const role = AGENT.test(who) || (own && who.toLowerCase() === own) ? "agent" : "prospect";
    lines.push({ role, text: speaker[2]!.trim().slice(0, 2000) });
  }
  return lines.slice(0, 400);
}

/** The transcript as plain text for the extractor (data, never instructions). */
export function transcriptText(lines: CallLine[]): string {
  return lines.map((l) => `${l.role === "agent" ? "Business" : l.role === "prospect" ? "Customer" : "Note"}: ${l.text}`).join("\n").slice(0, 12_000);
}

/** The values the owner changed from what the call captured. */
export function editedKeys(captured: Captured, form: Captured): string[] {
  return Object.keys(form).filter((k) => (form as Record<string, string>)[k] !== (captured as Record<string, string | undefined>)[k]);
}

/** An Australian mobile the way people write it: +61412345678 -> 0412 345 678 (anything else as given). */
export function displayMobile(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  const m = /^\+614(\d{2})(\d{3})(\d{3})$/.exec(v);
  return m ? `04${m[1]} ${m[2]} ${m[3]}` : v;
}

/** "3 min 05 s" for a call length. */
export function callLength(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}
