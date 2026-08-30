// Pure, client-safe CRM CSV parsing / mapping / validation helpers.
// This module NEVER writes leads, conversations, messages or jobs.
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";

export const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_CSV_ROWS = 2000;

export type CsvTable = { headers: string[]; rows: string[][] };

export class CsvParseError extends Error {}

/** Reads the first non-empty line, respecting quoted values (which may span lines). */
function firstLine(text: string): string {
  let inQuotes = false;
  let line = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      line += char;
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (line.trim() !== "") return line;
      line = "";
      continue;
    }
    line += char;
  }
  return line;
}

/** Counts delimiter candidates outside quoted values. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

/** Comma by default; tab or semicolon only when clearly dominant in the header line. */
export function detectDelimiter(text: string): "," | "\t" | ";" {
  const header = firstLine(text.replace(/^\uFEFF/, ""));
  const commas = countOutsideQuotes(header, ",");
  const tabs = countOutsideQuotes(header, "\t");
  const semis = countOutsideQuotes(header, ";");
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas && semis > tabs) return ";";
  return ",";
}

/** RFC4180-ish parser: quoted fields, escaped quotes, CRLF tolerant, delimiter sniffing. */
export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (inQuotes) throw new CsvParseError("The CSV has an unterminated quoted value.");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) throw new CsvParseError("The file is empty.");

  // Trailing empty columns (common in spreadsheet exports) are not real fields.
  const trimTrailingEmpty = (row: string[], keep: number): string[] => {
    const out = [...row];
    while (out.length > keep && (out[out.length - 1] ?? "").trim() === "") out.pop();
    return out;
  };

  const headers = trimTrailingEmpty(nonEmpty[0] ?? [], 1).map((cell) => cell.trim());
  if (headers.length === 0 || headers.every((cell) => cell === "")) {
    throw new CsvParseError("The first row must be a header row with column names.");
  }
  if (headers.some((cell) => cell === "")) {
    throw new CsvParseError("Every column in the header row must be named.");
  }
  const looksLikeData = headers.every((cell) => /^[+\d\s()-]+$/.test(cell));
  if (looksLikeData) throw new CsvParseError("The first row must be a header row, not data.");

  const rows = nonEmpty.slice(1).map((row) => trimTrailingEmpty(row, headers.length));
  return { headers, rows };
}


// --- field mapping ------------------------------------------------------------

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "contact name", "customer name"],
  email: ["email", "email address"],
  mobile_number: ["phone", "phone number", "mobile", "mobile number"],
  source_channel: ["source", "channel", "lead source", "source channel", "contact source", "platform"],
  source_form: ["form", "form name", "lead form", "source form", "campaign form"],
  status: ["stage", "status"],
  created_at: ["created", "created at", "created date", "created time"],
  owner: ["owner", "assigned to"],
  labels: ["labels", "label", "tags"],
  secondary_phone: ["secondary phone", "phone 2", "alternate phone"],
  whatsapp_number: ["whatsapp number", "whatsapp"],
  is_organic: ["is organic", "organic"],
};

export const METADATA_FIELDS = [
  "owner",
  "labels",
  "secondary_phone",
  "whatsapp_number",
  "is_organic",
] as const;

export function canonicalField(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

/** Headers with no mapping target — preserved in raw_row and surfaced in preview. */
export function unmappedColumns(headers: string[]): string[] {
  return headers.filter((header) => canonicalField(header) === null);
}

const STAGE_MAP: Record<string, LeadStatus> = {
  new: "new",
  "new lead": "new",
  lead: "new",
  open: "new",
  contacted: "contacted",
  attempted: "contacted",
  "waiting for customer": "waiting_for_customer",
  waiting: "waiting_for_customer",
  "follow up": "waiting_for_customer",
  replied: "customer_replied",
  "customer replied": "customer_replied",
  "ready for quote": "ready_for_quote",
  "quote ready": "ready_for_quote",
  "quote sent": "quote_sent",
  quoted: "quote_sent",
  proposal: "quote_sent",
  scheduled: "scheduled",
  booked: "scheduled",
  won: "completed",
  completed: "completed",
  complete: "completed",
  closed_won: "completed",
  "closed won": "completed",
  lost: "lost",
  "closed lost": "lost",
  dead: "lost",
  "opted out": "opted_out",
  unsubscribed: "opted_out",
  invalid: "invalid",
  junk: "invalid",
  spam: "invalid",
};

export function mapStage(value: string): LeadStatus | null {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!key) return null;
  if ((LEAD_STATUSES as readonly string[]).includes(key.replace(/ /g, "_"))) {
    return key.replace(/ /g, "_") as LeadStatus;
  }
  return STAGE_MAP[key] ?? null;
}

const SOURCE_MAP: Record<string, string> = {
  meta: "meta",
  facebook: "meta",
  instagram: "meta",
  "facebook ads": "meta",
  website: "website",
  web: "website",
  "web form": "website",
  "hosted page": "hosted_page",
  "quote page": "hosted_page",
  manual: "manual",
  phone: "manual",
  referral: "manual",
  crm: "manual",
  "crm import": "manual",
  import: "manual",
  fb: "meta",
  ig: "meta",
};

/** Meta lead-ads export platform codes. */
export const PLATFORM_MAP: Record<string, string> = {
  fb: "facebook",
  ig: "instagram",
  facebook: "facebook",
  instagram: "instagram",
};

export function normalizePlatform(raw: string): string {
  const key = raw.trim().toLowerCase();
  return PLATFORM_MAP[key] ?? raw.trim();
}

export function mapSourceChannel(value: string): string {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!key) return "unknown";
  return SOURCE_MAP[key] ?? "unknown";
}

export type PhoneResult =
  | { kind: "empty" }
  | { kind: "mobile"; value: string }
  | { kind: "unsupported_type"; value: string }
  | { kind: "invalid" };

/** Australian normalisation. Only mobiles (04x) are supported for SMS. */
export function classifyAuPhone(raw: string): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { kind: "empty" };
  const digits = trimmed.replace(/[^\d+]/g, "");
  let e164: string | null = null;
  if (/^\+61[1-9]\d{7,9}$/.test(digits)) e164 = digits;
  else if (/^0[1-9]\d{8}$/.test(digits)) e164 = `+61${digits.slice(1)}`;
  else if (/^61[1-9]\d{8}$/.test(digits)) e164 = `+${digits}`;
  if (!e164) return { kind: "invalid" };
  if (/^\+614\d{8}$/.test(e164)) return { kind: "mobile", value: e164 };
  return { kind: "unsupported_type", value: e164 };
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(raw: string): { value: string | null; valid: boolean } {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return { value: null, valid: true };
  return { value: trimmed, valid: EMAIL_RE.test(trimmed) };
}

export function parseCreatedAt(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // D/M/YYYY (existing AU exports)
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // M/D/YY (US-style Meta lead-ads exports)
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  let iso = trimmed;
  if (dmy) {
    iso = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  } else if (mdy) {
    iso = `20${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type ValidationError = { code: string; field?: string; detail?: string };

export type NormalizedPayload = {
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  email_normalised: string | null;
  source_channel: string;
  /** Original CSV value for the mapped source header, preserved verbatim. */
  source_channel_raw: string | null;
  source_form: string | null;
  proposed_status: LeadStatus | null;
  proposed_created_at: string | null;
  source_metadata: Record<string, string>;
  unmapped_columns: string[];
};

export type PreparedRow = {
  row_number: number;
  raw_row: Record<string, string>;
  normalized_payload: NormalizedPayload;
  validation_errors: ValidationError[];
  duplicate_of_row: number | null;
};

function cell(headers: string[], row: string[], field: string): string {
  const index = headers.findIndex((header) => canonicalField(header) === field);
  if (index === -1) return "";
  return (row[index] ?? "").trim();
}

/** Map + validate one CSV row. Never mutates anything outside the return value. */
export function prepareRow(headers: string[], row: string[], rowNumber: number): PreparedRow {
  const raw: Record<string, string> = {};
  headers.forEach((header, index) => {
    raw[header] = row[index] ?? "";
  });

  const errors: ValidationError[] = [];
  if (row.length !== headers.length) {
    errors.push({
      code: "malformed_row",
      detail: `expected ${headers.length} fields, found ${row.length}`,
    });
  }
  const name = cell(headers, row, "name") || null;
  if (!name) errors.push({ code: "missing_name", field: "name" });

  const phoneRaw = cell(headers, row, "mobile_number");
  const phone = classifyAuPhone(phoneRaw);
  if (phone.kind === "invalid") {
    errors.push({ code: "invalid_phone", field: "mobile_number", detail: phoneRaw });
  } else if (phone.kind === "unsupported_type") {
    errors.push({ code: "unsupported_phone_type", field: "mobile_number", detail: phone.value });
  }

  const emailRaw = cell(headers, row, "email");
  const email = normaliseEmail(emailRaw);
  if (!email.valid) errors.push({ code: "invalid_email", field: "email", detail: emailRaw });

  const mobile = phone.kind === "mobile" ? phone.value : null;
  if (!mobile && !(email.valid && email.value)) {
    errors.push({ code: "missing_phone_and_email" });
  }

  const stageRaw = cell(headers, row, "status");
  const proposedStatus = stageRaw ? mapStage(stageRaw) : null;
  if (stageRaw && !proposedStatus) {
    errors.push({ code: "unmappable_stage", field: "status", detail: stageRaw });
  }

  const metadata: Record<string, string> = {};
  for (const field of METADATA_FIELDS) {
    const value = cell(headers, row, field);
    if (value) metadata[field] = value;
  }

  // Meta lead-ads export: preserve raw created_time and platform values, and
  // expose the normalized platform, alongside the mapped fields above.
  const literalValue = (literal: string): string => {
    const index = headers.findIndex((header) => header.trim().toLowerCase() === literal);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };
  const createdTimeRaw = literalValue("created_time");
  if (createdTimeRaw) metadata["created_time_raw"] = createdTimeRaw;
  const platformRaw = literalValue("platform");
  if (platformRaw) {
    metadata["platform_raw"] = platformRaw;
    metadata["platform"] = normalizePlatform(platformRaw);
  }

  return {
    row_number: rowNumber,
    raw_row: raw,
    normalized_payload: {
      name,
      mobile_number: mobile,
      email: email.valid ? email.value : null,
      email_normalised: email.valid ? email.value : null,
      source_channel: mapSourceChannel(cell(headers, row, "source_channel")),
      source_channel_raw: cell(headers, row, "source_channel") || null,
      source_form: cell(headers, row, "source_form") || null,
      proposed_status: proposedStatus,
      proposed_created_at: parseCreatedAt(cell(headers, row, "created_at")),
      source_metadata: metadata,
      unmapped_columns: unmappedColumns(headers),
    },
    validation_errors: errors,
    duplicate_of_row: null,
  };
}

/** Flags duplicates inside the uploaded batch. Phone and email checks run independently. */
export function flagInBatchDuplicates(rows: PreparedRow[]): PreparedRow[] {
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (const row of rows) {
    const phone = row.normalized_payload.mobile_number;
    const email = row.normalized_payload.email_normalised;
    if (phone && seenPhone.has(phone)) {
      row.duplicate_of_row ??= seenPhone.get(phone)!;
      row.validation_errors.push({
        code: "duplicate_phone_in_file",
        field: "mobile_number",
        detail: `row ${seenPhone.get(phone)}`,
      });
    }
    if (email && seenEmail.has(email)) {
      row.duplicate_of_row ??= seenEmail.get(email)!;
      row.validation_errors.push({
        code: "duplicate_email_in_file",
        field: "email",
        detail: `row ${seenEmail.get(email)}`,
      });
    }
    if (phone && !seenPhone.has(phone)) seenPhone.set(phone, row.row_number);
    if (email && !seenEmail.has(email)) seenEmail.set(email, row.row_number);
  }
  return rows;
}

export type ExistingLeadIndex = {
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
};

/** Flags matches against leads already stored for this business. */
export function flagExistingDuplicates(
  rows: PreparedRow[],
  existing: ExistingLeadIndex,
): (PreparedRow & { dedupe_match_lead_id: string | null })[] {
  return rows.map((row) => {
    const phone = row.normalized_payload.mobile_number;
    const email = row.normalized_payload.email_normalised;
    const phoneMatch = phone ? (existing.byPhone.get(phone) ?? null) : null;
    const emailMatch = email ? (existing.byEmail.get(email) ?? null) : null;
    if (phoneMatch) {
      row.validation_errors.push({ code: "duplicate_existing_phone", field: "mobile_number" });
    } else if (emailMatch) {
      row.validation_errors.push({ code: "duplicate_existing_email", field: "email" });
    }
    return { ...row, dedupe_match_lead_id: phoneMatch ?? emailMatch };
  });
}

export const ERROR_LABELS: Record<string, string> = {
  missing_name: "Missing name",
  missing_phone_and_email: "No phone or email",
  invalid_phone: "Invalid Australian phone",
  unsupported_phone_type: "Not a mobile number",
  invalid_email: "Invalid email",
  unmappable_stage: "Stage could not be mapped",
  malformed_row: "Malformed row (column count does not match the header)",
  duplicate_phone_in_file: "Duplicate phone in this file",
  duplicate_email_in_file: "Duplicate email in this file",
  duplicate_existing_phone: "Matches an existing lead (phone)",
  duplicate_existing_email: "Matches an existing lead (email)",
};
