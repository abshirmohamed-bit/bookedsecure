// Pure, client-safe helpers for editing ONE staged CRM import row.
//
// SAFETY: this module is preview-only maths. It never writes leads,
// conversations, messages, jobs, revenue, notifications or automation, and
// never calls a messaging provider. It only re-derives normalized values,
// validation issues and classification inputs for a staged row so the owner can
// correct an import exception before anything is committed.

import {
  classifyAuPhone,
  mapSourceChannel,
  mapStage,
  normaliseEmail,
  parseCreatedAt,
  type ValidationError,
} from "@/lib/csv-import";
import type { LeadStatus } from "@/lib/domain";

export const STAGED_EDIT_SCOPE_NOTICE =
  "Changes apply only to this staged import row. No live lead is created or updated.";

export const EDITABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "secondary_phone",
  "whatsapp_number",
  "status",
  "source",
  "form",
  "channel",
  "owner",
  "labels",
  "created_at",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const EDITABLE_FIELD_LABELS: Record<EditableField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  secondary_phone: "Secondary phone",
  whatsapp_number: "WhatsApp number",
  status: "Stage / status",
  source: "Source",
  form: "Form",
  channel: "Channel",
  owner: "Owner",
  labels: "Labels",
  created_at: "Created date",
};

/** Metadata keys used to hold the corrected copies of metadata-only fields. */
const METADATA_KEY: Partial<Record<EditableField, string>> = {
  secondary_phone: "secondary_phone",
  whatsapp_number: "whatsapp_number",
  channel: "channel",
  owner: "owner",
  labels: "labels",
};

/** Field-level validation codes this module owns and fully recomputes. */
export const FIELD_ERROR_CODES = [
  "missing_name",
  "invalid_phone",
  "unsupported_phone_type",
  "invalid_email",
  "missing_phone_and_email",
  "unmappable_stage",
] as const;

/** Duplicate codes are owned by the tenant-scoped preflight, not by field edits. */
export const DUPLICATE_ERROR_CODES = [
  "duplicate_phone_in_file",
  "duplicate_email_in_file",
  "duplicate_existing_phone",
  "duplicate_existing_email",
] as const;

/** Human wording for why a staged row is an exception. */
export const EXCEPTION_LABELS: Record<string, string> = {
  invalid_phone: "Invalid phone",
  unsupported_phone_type: "Non-mobile phone",
  missing_phone: "Missing phone",
  missing_name: "Missing name",
  missing_email: "Missing email",
  invalid_email: "Invalid email",
  missing_phone_and_email: "Missing phone and email",
  unmappable_stage: "Unmapped stage",
  malformed_row: "Other validation error",
  duplicate_phone_in_file: "Potential duplicate",
  duplicate_email_in_file: "Potential duplicate",
  duplicate_existing_phone: "Potential duplicate",
  duplicate_existing_email: "Potential duplicate",
};

export function exceptionLabel(code: string): string {
  return EXCEPTION_LABELS[code] ?? "Other validation error";
}

/** Fields each validation code should be surfaced against in the editor. */
export const ISSUE_FIELDS: Record<string, EditableField[]> = {
  missing_name: ["name"],
  invalid_phone: ["phone"],
  unsupported_phone_type: ["phone"],
  missing_phone_and_email: ["phone", "email"],
  invalid_email: ["email"],
  unmappable_stage: ["status"],
  duplicate_phone_in_file: ["phone"],
  duplicate_existing_phone: ["phone"],
  duplicate_email_in_file: ["email"],
  duplicate_existing_email: ["email"],
};

export function issuesForField(errors: { code: string; detail?: string }[], field: EditableField) {
  return errors.filter((issue) => (ISSUE_FIELDS[issue.code] ?? []).includes(field));
}

// --- editable value snapshot --------------------------------------------------

export type EditableValues = Record<EditableField, string>;

export type StagedPayloadShape = {
  name?: string | null;
  email?: string | null;
  email_normalised?: string | null;
  mobile_number?: string | null;
  source_channel?: string | null;
  source_channel_raw?: string | null;
  source_form?: string | null;
  proposed_status?: string | null;
  proposed_created_at?: string | null;
  source_metadata?: Record<string, string> | null;
  edits?: StagedEditState | null;
};

export type StagedEditState = {
  /** Snapshot of the parsed values before the first ever edit. */
  original: EditableValues;
  edited_fields: EditableField[];
  last_edited_at: string;
  last_edited_by: string | null;
  last_reason: string | null;
  revision: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Current editable values for a staged row, derived from its payload. */
export function readEditableValues(payload: StagedPayloadShape | null | undefined): EditableValues {
  const meta = (payload?.source_metadata ?? {}) as Record<string, string>;
  return {
    name: text(payload?.name),
    email: text(payload?.email),
    phone: text(payload?.mobile_number),
    secondary_phone: text(meta["secondary_phone"]),
    whatsapp_number: text(meta["whatsapp_number"]),
    status: text(payload?.proposed_status),
    source: text(payload?.source_channel_raw) || text(payload?.source_channel),
    form: text(payload?.source_form),
    channel: text(meta["channel"]),
    owner: text(meta["owner"]),
    labels: text(meta["labels"]),
    created_at: text(payload?.proposed_created_at),
  };
}

/** The values originally parsed from the upload (never overwritten by edits). */
export function readOriginalValues(payload: StagedPayloadShape | null | undefined): EditableValues {
  const stored = payload?.edits?.original;
  if (stored) {
    const current = readEditableValues(payload);
    const out = {} as EditableValues;
    for (const field of EDITABLE_FIELDS) out[field] = text(stored[field]) || "";
    // Any field missing from an older snapshot falls back to the current value.
    for (const field of EDITABLE_FIELDS) if (!(field in stored)) out[field] = current[field];
    return out;
  }
  return readEditableValues(payload);
}

export function readEditState(payload: StagedPayloadShape | null | undefined): StagedEditState | null {
  const state = payload?.edits;
  if (!state || !state.original) return null;
  return {
    original: state.original,
    edited_fields: Array.isArray(state.edited_fields)
      ? state.edited_fields.filter((field): field is EditableField =>
          (EDITABLE_FIELDS as readonly string[]).includes(field),
        )
      : [],
    last_edited_at: typeof state.last_edited_at === "string" ? state.last_edited_at : "",
    last_edited_by: typeof state.last_edited_by === "string" ? state.last_edited_by : null,
    last_reason: typeof state.last_reason === "string" ? state.last_reason : null,
    revision: Number.isInteger(state.revision) ? state.revision : 0,
  };
}

/** The created date is only correctable when it is currently missing or invalid. */
export function isCreatedDateEditable(payload: StagedPayloadShape | null | undefined): boolean {
  const current = text(payload?.proposed_created_at);
  if (!current) return true;
  return Number.isNaN(new Date(current).getTime());
}

// --- normalization + revalidation ---------------------------------------------

export class StagedEditError extends Error {}

export type NormalizedEdit = {
  name: string | null;
  email: string | null;
  email_normalised: string | null;
  mobile_number: string | null;
  /** The value the owner typed, kept verbatim for the phone field. */
  phone_input: string | null;
  secondary_phone: string | null;
  whatsapp_number: string | null;
  proposed_status: LeadStatus | null;
  status_input: string | null;
  source_channel: string;
  source_input: string | null;
  source_form: string | null;
  channel: string | null;
  owner: string | null;
  labels: string | null;
  proposed_created_at: string | null;
  created_input: string | null;
  errors: ValidationError[];
};

/**
 * Re-run every field normalization for one edited row: the shared Australian
 * phone classifier, email validation, name validation and stage mapping.
 * Pure — identical input always yields identical output.
 */
export function normalizeEditableValues(values: EditableValues): NormalizedEdit {
  const errors: ValidationError[] = [];

  const name = text(values.name) || null;
  if (!name) errors.push({ code: "missing_name", field: "name" });

  const phoneInput = text(values.phone);
  const phone = classifyAuPhone(phoneInput);
  if (phone.kind === "invalid") {
    errors.push({ code: "invalid_phone", field: "mobile_number", detail: phoneInput });
  } else if (phone.kind === "unsupported_type") {
    errors.push({ code: "unsupported_phone_type", field: "mobile_number", detail: phone.value });
  }
  const mobile = phone.kind === "mobile" ? phone.value : null;

  const emailInput = text(values.email);
  const email = normaliseEmail(emailInput);
  if (!email.valid) errors.push({ code: "invalid_email", field: "email", detail: emailInput });

  if (!mobile && !(email.valid && email.value)) errors.push({ code: "missing_phone_and_email" });

  const statusInput = text(values.status);
  const status = statusInput ? mapStage(statusInput) : null;
  if (statusInput && !status) {
    errors.push({ code: "unmappable_stage", field: "status", detail: statusInput });
  }

  const createdInput = text(values.created_at);
  const created = createdInput ? parseCreatedAt(createdInput) : null;

  const sourceInput = text(values.source);

  return {
    name,
    email: email.valid ? email.value : null,
    email_normalised: email.valid ? email.value : null,
    mobile_number: mobile,
    phone_input: phoneInput || null,
    secondary_phone: text(values.secondary_phone) || null,
    whatsapp_number: text(values.whatsapp_number) || null,
    proposed_status: status,
    status_input: statusInput || null,
    source_channel: mapSourceChannel(sourceInput),
    source_input: sourceInput || null,
    source_form: text(values.form) || null,
    channel: text(values.channel) || null,
    owner: text(values.owner) || null,
    labels: text(values.labels) || null,
    proposed_created_at: created,
    created_input: createdInput || null,
    errors,
  };
}

export type FieldChange = { field: EditableField; from: string; to: string };

/** Only the fields the owner actually changed, for the audit record. */
export function diffEditableValues(before: EditableValues, after: EditableValues): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of EDITABLE_FIELDS) {
    const from = text(before[field]);
    const to = text(after[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

export type ApplyEditResult = {
  payload: StagedPayloadShape & Record<string, unknown>;
  values: EditableValues;
  normalized: NormalizedEdit;
  /** Field errors only; duplicate codes are re-added by the server preflight. */
  validation_errors: ValidationError[];
  changes: FieldChange[];
};

/**
 * Apply edited values to a staged payload.
 *
 * Protected data is never touched: the raw uploaded row, the batch id, the
 * business id, the row number, the import origin, `source_channel_raw`,
 * `source_metadata.stage_raw` and any assigned commit/idempotency bookkeeping
 * all stay exactly as uploaded. Corrected values are stored alongside them.
 */
export function applyStagedEdit(
  payload: (StagedPayloadShape & Record<string, unknown>) | null | undefined,
  requested: Partial<EditableValues>,
  context: { userId: string | null; reason?: string | null; now?: Date },
): ApplyEditResult {
  const base = (payload ?? {}) as StagedPayloadShape & Record<string, unknown>;
  const current = readEditableValues(base);
  const original = readOriginalValues(base);

  const next = { ...current } as EditableValues;
  for (const field of EDITABLE_FIELDS) {
    if (requested[field] === undefined) continue;
    if (field === "created_at" && !isCreatedDateEditable(base)) {
      throw new StagedEditError(
        "The created date is already valid, so it cannot be changed from the editor.",
      );
    }
    next[field] = text(requested[field]);
  }

  const normalized = normalizeEditableValues(next);
  const changes = diffEditableValues(current, next);

  const priorErrors = ((base as { validation_errors?: unknown }).validation_errors ?? []) as never[];
  void priorErrors; // validation errors live on the row, not the payload

  const meta = { ...((base.source_metadata ?? {}) as Record<string, string>) };
  for (const field of EDITABLE_FIELDS) {
    const key = METADATA_KEY[field];
    if (!key) continue;
    const value = text(next[field]);
    if (value) meta[key] = value;
    else delete meta[key];
  }
  // Preserve the uploaded phone/stage/source text explicitly, alongside the fix.
  if (normalized.phone_input) meta["phone_corrected"] = normalized.phone_input;
  if (original.phone && !meta["phone_raw"]) meta["phone_raw"] = original.phone;
  if (normalized.status_input) meta["stage_corrected"] = normalized.status_input;
  if (normalized.source_input) meta["source_corrected"] = normalized.source_input;

  const prior = readEditState(base);
  const editedFields = new Set<EditableField>(prior?.edited_fields ?? []);
  for (const change of changes) editedFields.add(change.field);

  const now = context.now ?? new Date();
  const edits: StagedEditState =
    changes.length === 0 && prior
      ? prior
      : {
          original,
          edited_fields: [...editedFields],
          last_edited_at: now.toISOString(),
          last_edited_by: context.userId,
          last_reason: text(context.reason) || null,
          revision: (prior?.revision ?? 0) + (changes.length > 0 ? 1 : 0),
        };

  return {
    payload: {
      ...base,
      name: normalized.name,
      email: normalized.email,
      email_normalised: normalized.email_normalised,
      mobile_number: normalized.mobile_number,
      proposed_status: normalized.proposed_status,
      proposed_created_at: normalized.proposed_created_at ?? base.proposed_created_at ?? null,
      source_channel: normalized.source_channel,
      source_form: normalized.source_form,
      source_metadata: meta,
      edits,
    },
    values: next,
    normalized,
    validation_errors: normalized.errors,
    changes,
  };
}

// --- resulting row state ------------------------------------------------------

export const STAGED_ROW_STATES = [
  "auto_include_candidate",
  "pending_review",
  "excluded",
  "potential_duplicate",
  "invalid_contact",
  "already_committed",
] as const;
export type StagedRowState = (typeof STAGED_ROW_STATES)[number];

export const STAGED_ROW_STATE_LABELS: Record<StagedRowState, string> = {
  auto_include_candidate: "Auto-include candidate",
  pending_review: "Pending review",
  excluded: "Excluded",
  potential_duplicate: "Potential duplicate",
  invalid_contact: "Invalid contact",
  already_committed: "Already committed",
};

const INVALID_CONTACT_CODES = [
  "invalid_phone",
  "unsupported_phone_type",
  "missing_phone_and_email",
  "invalid_email",
] as const;

/**
 * Derive the single state a staged row sits in. Exactly one state is returned,
 * in a fixed precedence order so the result is deterministic.
 */
export function resolveStagedRowState(row: {
  commit_status?: string | undefined;
  review_decision?: string | undefined;
  classification?: string | undefined;
  validation_errors: { code: string }[];
  dedupe_match_lead_id?: string | null | undefined;
  duplicate_of_row?: number | null | undefined;
}): StagedRowState {
  if (row.commit_status === "committed") return "already_committed";
  if (row.review_decision === "exclude") return "excluded";
  const codes = row.validation_errors.map((issue) => issue.code);
  if (row.dedupe_match_lead_id || (row.duplicate_of_row ?? null) !== null) {
    return "potential_duplicate";
  }
  if (codes.some((code) => (INVALID_CONTACT_CODES as readonly string[]).includes(code))) {
    return "invalid_contact";
  }
  if (row.classification === "auto_include" && row.review_decision === "include") {
    return "auto_include_candidate";
  }
  return "pending_review";
}

/** Rows may only be edited while they are staged and uncommitted. */
export function canEditStagedRow(row: { commit_status?: string }): boolean {
  return row.commit_status !== "committed";
}

/** Mask a contact value so duplicate matches can be shown safely. */
export function maskContact(value: string | null | undefined): string {
  const raw = text(value);
  if (!raw) return "—";
  if (raw.includes("@")) {
    const [local = "", domain = ""] = raw.split("@");
    const head = local.slice(0, 1);
    return `${head}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }
  const tail = raw.slice(-3);
  return `${"•".repeat(Math.max(raw.length - 3, 0))}${tail}`;
}

export function maskLeadId(value: string | null | undefined): string {
  const raw = text(value);
  return raw ? `${raw.slice(0, 8)}…` : "—";
}
