// Pure, client-safe CRM CSV parsing / mapping / validation helpers.
// This module NEVER writes leads, conversations, messages or jobs.
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";
import { repairPhone, type PhoneRepair, type RepairOptions } from "@/lib/phone-repair";


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
  name: [
    "name",
    "full name",
    "fullname",
    "contact name",
    "customer name",
    "client name",
    "lead name",
    "display name",
    "contact",
    "customer",
    "client",
  ],
  first_name: ["first name", "firstname", "given name", "first", "fname", "forename"],
  last_name: ["last name", "lastname", "surname", "family name", "last", "lname"],
  email: [
    "email",
    "email address",
    "e mail",
    "e mail address",
    "emails",
    "primary email",
    "work email",
    "personal email",
    "email 1",
    "email1",
  ],
  mobile_number: [
    "phone",
    "phone number",
    "mobile",
    "mobile number",
    "mobile phone",
    "mobile no",
    "mob",
    "cell",
    "cell phone",
    "cellphone",
    "contact number",
    "contact phone",
    "primary phone",
    "phone 1",
    "phone1",
    "telephone",
    "tel",
    "number",
    "phone no",
  ],
  source_channel: [
    "source",
    "lead source",
    "source channel",
    "source type",
    "contact source",
    "platform",
    "origin",
    "lead origin",
    "utm source",
    "referrer",
    "how did you hear about us",
  ],
  source_form: ["form", "form name", "lead form", "source form", "campaign form"],
  status: ["stage", "status", "lead status", "pipeline stage"],
  created_at: [
    "created",
    "created at",
    "created date",
    "created time",
    "date created",
    "date added",
    "enquiry date",
  ],
  owner: ["owner", "assigned to"],
  labels: ["labels", "label", "tags"],
  channel: ["channel"],
  secondary_phone: ["secondary phone", "secondary phone number", "phone 2", "alternate phone"],
  whatsapp_number: ["whatsapp number", "whatsapp"],
  is_organic: ["is organic", "organic"],
  // A detailer needs where the car was and what was done last time.
  service_address: ["address", "street address", "service address", "location"],
  suburb: ["suburb", "city", "town", "locality"],
  service_intent: [
    "service",
    "service requested",
    "last service",
    "previous service",
    "service type",
    "job",
    "job type",
  ],
  vehicle_type: ["vehicle", "vehicle type", "car", "car type", "make and model"],
  notes: ["notes", "note", "comments", "description"],
};

export const METADATA_FIELDS = [
  "owner",
  "labels",
  "channel",
  "secondary_phone",
  "whatsapp_number",
  "is_organic",
  "service_address",
  "suburb",
  "service_intent",
  "vehicle_type",
  "notes",
  // Kept verbatim so the original split name is never lost.
  "first_name",
  "last_name",
] as const;


export function canonicalField(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

/** Headers with no mapping target. preserved in raw_row and surfaced in preview. */
export function unmappedColumns(headers: string[]): string[] {
  return headers.filter((header) => canonicalField(header) === null);
}

const STAGE_MAP: Record<string, LeadStatus> = {
  // A file never produces a "New" lead: that status is reserved for enquiries
  // customers start themselves. Anything still open in the old system is a
  // previous lead.
  new: "previous_lead",
  "new lead": "previous_lead",
  lead: "previous_lead",
  open: "previous_lead",
  // Historical CRM (GoDaddy) stages. Conservative: a stage is a lead status
  // label only. mapping never creates a job, revenue, booking, conversation
  // or automation event.
  intake: "previous_lead",
  converted: "completed",
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
  // Stage words in STAGE_MAP win, so a file stage of "new" becomes previous_lead
  // rather than the customer-initiated "new" status.
  const mapped = STAGE_MAP[key];
  if (mapped) return mapped;
  if ((LEAD_STATUSES as readonly string[]).includes(key.replace(/ /g, "_"))) {
    return key.replace(/ /g, "_") as LeadStatus;
  }
  return null;
}

/**
 * Preview-only re-mapping of a staged row's CRM stage.
 *
 * Pure: given the stage text preserved at upload time, it returns the internal
 * status plus the validation errors with any stale `unmappable_stage` issue
 * removed once the stage is mappable. Unknown stages keep the exception.
 */
export function restageStage<E extends { code: string }>(
  stageRaw: string | null | undefined,
  errors: E[],
): { status: LeadStatus | null; stage_raw: string | null; errors: E[]; changed: boolean } {
  const raw = (stageRaw ?? "").trim();
  if (!raw) return { status: null, stage_raw: null, errors, changed: false };
  const status = mapStage(raw);
  if (!status) return { status: null, stage_raw: raw, errors, changed: false };
  const cleaned = errors.filter((issue) => issue.code !== "unmappable_stage");
  return { status, stage_raw: raw, errors: cleaned, changed: cleaned.length !== errors.length };
}

const SOURCE_MAP: Record<string, string> = {
  meta: "meta",
  facebook: "meta",
  instagram: "meta",
  "facebook ads": "meta",
  "facebook lead ads": "meta",
  "facebook lead form": "meta",
  "meta ads": "meta",
  "instagram ads": "meta",
  fb: "meta",
  ig: "meta",
  website: "website",
  web: "website",
  "web form": "website",
  "web site": "website",
  "website form": "website",
  "contact form": "website",
  "quote form": "website",
  google: "website",
  "google ads": "website",
  seo: "website",
  organic: "website",
  godaddy: "godaddy",
  "godaddy website": "godaddy",
  "go daddy": "godaddy",
  "godaddy form": "godaddy",
  "hosted page": "hosted_page",
  "quote page": "hosted_page",
  manual: "manual",
  phone: "manual",
  "phone call": "manual",
  call: "manual",
  walkin: "manual",
  "walk in": "manual",
  referral: "manual",
  referred: "manual",
  "word of mouth": "manual",
  repeat: "manual",
  "repeat customer": "manual",
  crm: "manual",
  "crm import": "manual",
  import: "manual",
  spreadsheet: "manual",
  csv: "manual",
  hubspot: "manual",
  mailchimp: "manual",
  square: "manual",
  quickbooks: "manual",
  xero: "manual",
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

function sourceKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function mapSourceChannel(value: string): string {
  const key = sourceKey(value);
  if (!key) return "unknown";
  const exact = SOURCE_MAP[key];
  if (exact) return exact;
  // Free-text sources ("enquiry via our GoDaddy site") still resolve to a real
  // channel when they clearly name one. Unrecognised wording stays "unknown"
  // and the original text is always preserved in `source_channel_raw`.
  const contains: [string, string][] = [
    ["godaddy", "godaddy"],
    ["go daddy", "godaddy"],
    ["facebook", "meta"],
    ["instagram", "meta"],
    ["meta", "meta"],
    ["quote page", "hosted_page"],
    ["website", "website"],
    ["web", "website"],
    ["google", "website"],
    ["referral", "manual"],
    ["word of mouth", "manual"],
    ["phone", "manual"],
    ["call", "manual"],
    ["repeat", "manual"],
    ["crm", "manual"],
    ["import", "manual"],
  ];
  for (const [needle, channel] of contains) {
    if (key.includes(needle)) return channel;
  }
  return "unknown";
}

/**
 * Resolve the source channel for a row: the row's own source column first, then
 * the platform column, then the uploaded file name (e.g. "godaddy-leads.csv").
 * Falls back to `crm_import_default` so an import is never mis-attributed.
 */
export function resolveSourceChannel(input: {
  sourceRaw?: string | null;
  platformRaw?: string | null;
  filename?: string | null;
}): string {
  const fromSource = mapSourceChannel(input.sourceRaw ?? "");
  if (fromSource !== "unknown") return fromSource;
  const fromPlatform = mapSourceChannel(input.platformRaw ?? "");
  if (fromPlatform !== "unknown") return fromPlatform;
  const fromFile = mapSourceChannel((input.filename ?? "").replace(/\.[a-z0-9]+$/i, ""));
  if (fromFile !== "unknown") return fromFile;
  return "unknown";
}

// --- name resolution ----------------------------------------------------------

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Build a usable display name from whatever the file provided, in priority
 * order: an explicit name column, separate first/last columns, then the email
 * address's own wording (`jane.smith@…` → "Jane Smith"). A single name is
 * accepted as-is. Returns null only when nothing usable exists.
 * Pure. it never invents a surname and never mixes values between rows.
 */
export function deriveName(input: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string | null {
  const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
  const explicit = clean(input.name);
  if (explicit) return explicit;

  const joined = [clean(input.firstName), clean(input.lastName)].filter(Boolean).join(" ");
  if (joined) return joined;

  const local = clean(input.email).split("@")[0] ?? "";
  if (local) {
    const parts = local
      .split(/[._+\-\d]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1 && /^[a-z']+$/i.test(part))
      .slice(0, 2)
      .map(titleCase);
    if (parts.length > 0) return parts.join(" ");
  }
  return null;
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

export type ResolvedPhone = {
  /** Repaired E.164 mobile, or null when no high-confidence mobile exists. */
  mobile_number: string | null;
  repair: PhoneRepair;
  errors: ValidationError[];
};

/**
 * Deterministic phone resolution for a staged row: normalize → repair candidate
 * → validate. High-confidence repairs are applied to the staged normalized
 * value; the raw value is returned untouched inside `repair.original`.
 * Pure. no writes, no provider calls, and no subscriber digit is invented.
 */
export function resolvePhoneWithRepair(raw: string, options?: RepairOptions): ResolvedPhone {
  const repair = repairPhone(raw, options ?? {});
  const errors: ValidationError[] = [];
  if (repair.applied) return { mobile_number: repair.normalized, repair, errors };
  switch (repair.classification) {
    case "empty_phone":
      break;
    case "valid_au_landline":
      errors.push({
        code: "unsupported_phone_type",
        field: "mobile_number",
        detail: repair.normalized ?? repair.cleaned,
      });
      break;
    default:
      errors.push({ code: "invalid_phone", field: "mobile_number", detail: repair.original });
      break;
  }
  return { mobile_number: null, repair, errors };
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

  // MM/DD/YYYY h:mm AM|PM (CRM exports). deterministic UTC parse.
  const mdyTime = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/,
  );
  if (mdyTime) {
    let hour = Number(mdyTime[4]);
    if (hour < 1 || hour > 12) return null;
    const isPm = (mdyTime[7] ?? "").toLowerCase() === "p";
    if (hour === 12) hour = 0;
    if (isPm) hour += 12;
    const date = new Date(
      Date.UTC(
        Number(mdyTime[3]),
        Number(mdyTime[1]) - 1,
        Number(mdyTime[2]),
        hour,
        Number(mdyTime[5]),
        Number(mdyTime[6] ?? 0),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

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
  /** Deterministic phone repair provenance (preview-only). */
  phone_repair?: PhoneRepair;
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
export function prepareRow(
  headers: string[],
  row: string[],
  rowNumber: number,
  options?: { filename?: string | null },
): PreparedRow {
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

  const phoneRaw = cell(headers, row, "mobile_number");
  const resolved = resolvePhoneWithRepair(phoneRaw);
  errors.push(...resolved.errors);

  const emailRaw = cell(headers, row, "email");
  const email = normaliseEmail(emailRaw);
  if (!email.valid) errors.push({ code: "invalid_email", field: "email", detail: emailRaw });

  const mobile = resolved.mobile_number;

  // Name resolution: explicit name, then first/last columns, then the email
  // wording, then the contact's own number as a last-resort label.
  const name =
    deriveName({
      name: cell(headers, row, "name"),
      firstName: cell(headers, row, "first_name"),
      lastName: cell(headers, row, "last_name"),
      email: email.valid ? email.value : null,
    }) ?? mobile;
  if (!name) errors.push({ code: "missing_name", field: "name" });

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
  const createdRaw = cell(headers, row, "created_at");
  if (createdRaw) metadata["created_at_raw"] = createdRaw;
  // Preserve the original CRM stage text verbatim (e.g. "Intake", "Converted").
  if (stageRaw) metadata["stage_raw"] = stageRaw;
  // The uploaded phone text is preserved verbatim alongside any repair.
  if (phoneRaw) metadata["phone_raw"] = phoneRaw;




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
      source_channel: resolveSourceChannel({
        sourceRaw: cell(headers, row, "source_channel"),
        platformRaw: platformRaw,
        filename: options?.filename ?? null,
      }),
      source_channel_raw: cell(headers, row, "source_channel") || null,
      source_form: cell(headers, row, "source_form") || null,
      proposed_status: proposedStatus,
      proposed_created_at: parseCreatedAt(cell(headers, row, "created_at")),
      source_metadata: metadata,
      unmapped_columns: unmappedColumns(headers),
      phone_repair: resolved.repair,
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
