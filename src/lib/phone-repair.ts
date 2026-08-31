// Pure, client-safe automatic phone repair engine for staged CRM import rows.
//
// SAFETY: this module is deterministic maths only. It never reads or writes
// leads, conversations, messages, jobs, revenue, notifications or automation,
// and never calls a messaging provider. Callers apply its output to STAGED
// preview rows only, and the original raw value is always preserved.
//
// It never invents, replaces or reorders a subscriber digit: every repair is a
// combination of removing formatting punctuation, adding the Australian country
// code, adding/removing the standard Australian trunk prefix `0`, or removing a
// known extra trunk zero directly after `+61`.

export const REPAIR_ENGINE_VERSION = "phone-repair-v1";

/**
 * BookedSecure currently operates in Australia only, so the bare nine-digit
 * mobile rule is high confidence. When other countries are supported, pass a
 * different (or unknown) country and the rule is downgraded to medium.
 */
export const DEFAULT_REPAIR_COUNTRY = "AU" as const;
export type RepairCountry = "AU" | "unknown";

export type RepairOptions = {
  /** Import country context. Defaults to the Australia-only product context. */
  country?: RepairCountry;
};

export const PHONE_REPAIR_CONFIDENCES = ["high", "medium", "low", "none"] as const;
export type PhoneRepairConfidence = (typeof PHONE_REPAIR_CONFIDENCES)[number];

export const PHONE_REPAIR_ACTIONS = [
  "none",
  "no_change",
  "removed_formatting",
  "added_country_code",
  "removed_trunk_prefix",
  "removed_extra_trunk_zero",
  "not_repairable",
] as const;
export type PhoneRepairAction = (typeof PHONE_REPAIR_ACTIONS)[number];

export const PHONE_REPAIR_ACTION_LABELS: Record<PhoneRepairAction, string> = {
  none: "No phone supplied",
  no_change: "Already normalised",
  removed_formatting: "Removed formatting characters",
  added_country_code: "Added Australian country code",
  removed_trunk_prefix: "Removed trunk prefix and added +61",
  removed_extra_trunk_zero: "Removed the extra trunk zero after +61",
  not_repairable: "No deterministic repair available",
};

export const PHONE_CLASSIFICATIONS = [
  "empty_phone",
  "valid_au_mobile",
  "repaired_au_mobile",
  "valid_au_landline",
  "invalid_phone",
  "incomplete_phone",
  "ambiguous_phone",
] as const;
export type PhoneClassification = (typeof PHONE_CLASSIFICATIONS)[number];

export const PHONE_CLASSIFICATION_LABELS: Record<PhoneClassification, string> = {
  empty_phone: "No phone",
  valid_au_mobile: "Valid Australian mobile",
  repaired_au_mobile: "Repaired Australian mobile",
  valid_au_landline: "Valid Australian landline / non-mobile",
  invalid_phone: "Invalid phone",
  incomplete_phone: "Incomplete phone",
  ambiguous_phone: "Ambiguous phone",
};

export type PhoneRepair = {
  /** The uploaded value, verbatim and immutable. */
  original: string;
  /** Formatting punctuation removed; digits untouched. */
  cleaned: string;
  /** E.164 candidate, or null when no unambiguous value exists. */
  normalized: string | null;
  action: PhoneRepairAction;
  actions: PhoneRepairAction[];
  reason: string;
  confidence: PhoneRepairConfidence;
  classification: PhoneClassification;
  /** True only for high-confidence repairs that yield a valid AU mobile. */
  applied: boolean;
  country: RepairCountry;
  engine_version: string;
  /** Set when the repair is recorded against a staged row. */
  repaired_at?: string;
  staged_row_id?: string | null;
  batch_id?: string | null;
};

const MOBILE_RE = /^\+614\d{8}$/;
const AU_LANDLINE_AREA = /^[2378]$/;

export function isAuMobileE164(value: string | null | undefined): boolean {
  return typeof value === "string" && MOBILE_RE.test(value);
}

/** Removes harmless formatting punctuation. Digits and a leading + are kept. */
export function cleanPhoneInput(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const stripped = trimmed.replace(/[\s()\-.\u2013\u2014_/\\]/g, "");
  const plus = stripped.startsWith("+") ? "+" : "";
  return `${plus}${stripped.replace(/\+/g, "")}`;
}

function result(input: Partial<PhoneRepair> & { original: string; cleaned: string }): PhoneRepair {
  const actions = input.actions ?? (input.action ? [input.action] : ["none"]);
  const primary = input.action ?? actions[0] ?? "none";
  const normalized = input.normalized ?? null;
  const confidence = input.confidence ?? "none";
  return {
    original: input.original,
    cleaned: input.cleaned,
    normalized,
    action: primary,
    actions,
    reason: input.reason ?? "",
    confidence,
    classification: input.classification ?? "invalid_phone",
    applied: confidence === "high" && isAuMobileE164(normalized),
    country: input.country ?? DEFAULT_REPAIR_COUNTRY,
    engine_version: REPAIR_ENGINE_VERSION,
  };
}

/**
 * Deterministic Australian phone repair. Identical input always produces
 * identical output, so re-running a preview never applies a second repair.
 */
export function repairPhone(raw: string | null | undefined, options: RepairOptions = {}): PhoneRepair {
  const country: RepairCountry = options.country ?? DEFAULT_REPAIR_COUNTRY;
  const original = (raw ?? "").trim();
  const cleaned = cleanPhoneInput(original);
  const base = { original, cleaned, country };

  if (!original) {
    return result({
      ...base,
      action: "none",
      confidence: "none",
      classification: "empty_phone",
      reason: "No phone number supplied.",
    });
  }

  if (/[A-Za-z]/.test(original)) {
    return result({
      ...base,
      action: "not_repairable",
      confidence: "low",
      classification: "invalid_phone",
      reason: "The value contains letters, so it is not a phone number.",
    });
  }

  // Explicit non-Australian country code or international prefix: never repaired.
  const international = cleaned.startsWith("00");
  if ((cleaned.startsWith("+") && !cleaned.startsWith("+61")) || international) {
    return result({
      ...base,
      action: "not_repairable",
      confidence: "low",
      classification: "invalid_phone",
      reason:
        "The value carries a non-Australian country code or international prefix, so the Australian rules do not apply.",
    });
  }

  const digits = cleaned.replace(/\D/g, "");
  if (!digits) {
    return result({
      ...base,
      action: "not_repairable",
      confidence: "low",
      classification: "invalid_phone",
      reason: "The value contains no digits.",
    });
  }

  const formattingRemoved = cleaned !== original;
  const actions: PhoneRepairAction[] = [];
  if (formattingRemoved) actions.push("removed_formatting");

  const finish = (
    subscriber: string,
    extra: PhoneRepairAction[],
    reason: string,
    confidence: PhoneRepairConfidence = "high",
  ): PhoneRepair => {
    const normalized = `+61${subscriber}`;
    const all = [...actions, ...extra];
    const changed = normalized !== original;
    const isMobile = MOBILE_RE.test(normalized);
    return result({
      ...base,
      normalized,
      actions: all.length ? all : ["no_change"],
      action: extra[0] ?? (formattingRemoved ? "removed_formatting" : "no_change"),
      reason: changed ? reason : "Already a normalised Australian number.",
      confidence,
      classification: isMobile
        ? changed
          ? "repaired_au_mobile"
          : "valid_au_mobile"
        : "valid_au_landline",
    });
  };

  // --- +61 / 61 prefixed ------------------------------------------------------
  if (digits.startsWith("61")) {
    const rest = digits.slice(2);
    if (rest.startsWith("04") && rest.length === 10) {
      return finish(
        rest.slice(1),
        ["removed_extra_trunk_zero"],
        "Removed the extra trunk zero after the +61 country code.",
      );
    }
    if (rest.length === 9 && rest.startsWith("4")) {
      return finish(rest, [], "Normalised the +61 mobile number to E.164 form.");
    }
    if (rest.length === 9 && AU_LANDLINE_AREA.test(rest.slice(0, 1))) {
      return finish(rest, [], "Normalised the +61 landline number to E.164 form.");
    }
    if (rest.startsWith("0") && rest.length === 10 && AU_LANDLINE_AREA.test(rest.slice(1, 2))) {
      return finish(
        rest.slice(1),
        ["removed_extra_trunk_zero"],
        "Removed the extra trunk zero after the +61 country code.",
      );
    }
    return result({
      ...base,
      action: "not_repairable",
      confidence: "low",
      classification: rest.length < 9 ? "incomplete_phone" : "invalid_phone",
      reason: `After the +61 country code the number has ${rest.length} digits, which is not a valid Australian number.`,
    });
  }

  // --- local trunk form -------------------------------------------------------
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    if (digits.length === 10 && rest.startsWith("4")) {
      return finish(
        rest,
        ["removed_trunk_prefix"],
        "Removed the local trunk prefix 0 and added the Australian country code +61.",
      );
    }
    if (digits.length === 10 && AU_LANDLINE_AREA.test(rest.slice(0, 1))) {
      return finish(
        rest,
        ["removed_trunk_prefix"],
        "Removed the local trunk prefix 0 and added the Australian country code +61.",
      );
    }
    return result({
      ...base,
      action: "not_repairable",
      confidence: "low",
      classification: digits.length < 10 ? "incomplete_phone" : "invalid_phone",
      reason: `The local number has ${digits.length} digits, so it is not a valid Australian number.`,
    });
  }

  // --- bare subscriber number -------------------------------------------------
  if (digits.length === 9 && digits.startsWith("4")) {
    // Australia-only import context: a nine-digit value starting with 4 is an
    // Australian mobile missing both the trunk prefix and the country code.
    const confidence: PhoneRepairConfidence = country === "AU" ? "high" : "medium";
    const repaired = finish(
      digits,
      ["added_country_code"],
      country === "AU"
        ? "Nine-digit Australian mobile missing the trunk prefix and country code; added +61."
        : "Nine digits beginning with 4 look like an Australian mobile, but the import country is unknown.",
      confidence,
    );
    return repaired;
  }

  if (digits.length === 9 && AU_LANDLINE_AREA.test(digits.slice(0, 1))) {
    // Could be a landline missing its trunk prefix, or a truncated mobile.
    return result({
      ...base,
      normalized: `+61${digits}`,
      action: "added_country_code",
      actions: [...actions, "added_country_code"],
      confidence: "medium",
      classification: "ambiguous_phone",
      reason:
        "Nine digits beginning with an area-code digit have more than one valid reading, so this needs review.",
    });
  }

  return result({
    ...base,
    action: "not_repairable",
    confidence: "low",
    classification: digits.length < 9 ? "incomplete_phone" : "invalid_phone",
    reason: `The value has ${digits.length} digits after cleanup, which cannot be resolved to one unambiguous Australian number.`,
  });
}

/** Stamp provenance onto a repair record. Existing timestamps are preserved. */
export function stampRepair(
  repair: PhoneRepair,
  context: { stagedRowId?: string | null; batchId?: string | null; at?: string; previous?: PhoneRepair | null },
): PhoneRepair {
  const previous = context.previous ?? null;
  const sameOutcome =
    previous !== null &&
    previous.original === repair.original &&
    previous.normalized === repair.normalized &&
    previous.action === repair.action;
  return {
    ...repair,
    staged_row_id: context.stagedRowId ?? previous?.staged_row_id ?? null,
    batch_id: context.batchId ?? previous?.batch_id ?? null,
    repaired_at:
      sameOutcome && previous?.repaired_at ? previous.repaired_at : (context.at ?? new Date().toISOString()),
  };
}

/** Read a stored repair record out of a staged normalized_payload. */
export function readPhoneRepair(payload: unknown): PhoneRepair | null {
  const raw = (payload as { phone_repair?: unknown } | null)?.phone_repair as PhoneRepair | undefined;
  if (!raw || typeof raw.original !== "string") return null;
  return raw;
}

// --- summary + filters --------------------------------------------------------

export const REPAIR_FILTERS = [
  "all",
  "repaired_automatically",
  "needs_review",
  "invalid_phone",
  "non_mobile",
  "potential_duplicate",
  "auto_include_candidate",
] as const;
export type RepairFilter = (typeof REPAIR_FILTERS)[number];

export const REPAIR_FILTER_LABELS: Record<RepairFilter, string> = {
  all: "All rows",
  repaired_automatically: "Repaired automatically",
  needs_review: "Needs review",
  invalid_phone: "Invalid phone",
  non_mobile: "Non-mobile phone",
  potential_duplicate: "Potential duplicate",
  auto_include_candidate: "Auto-include candidate",
};

export type RepairableRowView = {
  mobile_number: string | null;
  normalized_payload?: unknown;
  dedupe_match_lead_id?: string | null;
  duplicate_of_row?: number | null;
  classification?: { classification?: string } | undefined;
  review?: { decision?: string } | undefined;
};

function rowRepair(row: RepairableRowView): PhoneRepair | null {
  return readPhoneRepair(row.normalized_payload);
}

export function rowIsDuplicate(row: RepairableRowView): boolean {
  return Boolean(row.dedupe_match_lead_id) || (row.duplicate_of_row ?? null) !== null;
}

export function matchesRepairFilter(row: RepairableRowView, filter: RepairFilter): boolean {
  const repair = rowRepair(row);
  switch (filter) {
    case "all":
      return true;
    case "repaired_automatically":
      return Boolean(repair?.applied && repair.classification === "repaired_au_mobile");
    case "needs_review":
      return (
        row.review?.decision === "pending" ||
        repair?.confidence === "medium" ||
        (repair?.confidence === "low" && repair.classification !== "empty_phone")
      );
    case "invalid_phone":
      return (
        repair?.classification === "invalid_phone" ||
        repair?.classification === "incomplete_phone" ||
        repair?.classification === "ambiguous_phone"
      );
    case "non_mobile":
      return repair?.classification === "valid_au_landline";
    case "potential_duplicate":
      return rowIsDuplicate(row);
    case "auto_include_candidate":
      return row.classification?.classification === "auto_include";
    default:
      return true;
  }
}

export type RepairSummary = {
  rows_scanned: number;
  high_confidence_applied: number;
  medium_confidence_suggestions: number;
  low_confidence_or_unrepairable: number;
  valid_au_mobiles: number;
  repaired_au_mobiles: number;
  valid_au_landlines: number;
  invalid_phones: number;
  incomplete_phones: number;
  ambiguous_phones: number;
  empty_phones: number;
  potential_duplicates: number;
  auto_include_candidates: number;
  /** Repairs that removed the extra trunk zero after +61. */
  extra_trunk_zero_repairs: number;
  /** Repairs of a bare nine-digit mobile beginning with 4. */
  nine_digit_mobile_repairs: number;
  engine_version: string;
};

/** Read a repair's actions safely, treating missing or malformed values as empty. */
function safeRepairActions(repair: PhoneRepair): PhoneRepairAction[] {
  const actions = (repair as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter((a): a is PhoneRepairAction => PHONE_REPAIR_ACTIONS.includes(a));
}

/** Read-only aggregate over staged preview rows. No writes, no provider calls. */
export function buildRepairSummary(rows: RepairableRowView[]): RepairSummary {
  const summary: RepairSummary = {
    rows_scanned: rows.length,
    high_confidence_applied: 0,
    medium_confidence_suggestions: 0,
    low_confidence_or_unrepairable: 0,
    valid_au_mobiles: 0,
    repaired_au_mobiles: 0,
    valid_au_landlines: 0,
    invalid_phones: 0,
    incomplete_phones: 0,
    ambiguous_phones: 0,
    empty_phones: 0,
    potential_duplicates: 0,
    auto_include_candidates: 0,
    extra_trunk_zero_repairs: 0,
    nine_digit_mobile_repairs: 0,
    engine_version: REPAIR_ENGINE_VERSION,
  };

  for (const row of rows) {
    if (rowIsDuplicate(row)) summary.potential_duplicates += 1;
    if (row.classification?.classification === "auto_include") summary.auto_include_candidates += 1;

    const repair = rowRepair(row);
    if (!repair) {
      if (isAuMobileE164(row.mobile_number)) summary.valid_au_mobiles += 1;
      continue;
    }
    if (repair.applied && repair.classification === "repaired_au_mobile") {
      summary.high_confidence_applied += 1;
    }
    if (repair.confidence === "medium") summary.medium_confidence_suggestions += 1;
    if (repair.confidence === "low") summary.low_confidence_or_unrepairable += 1;

    switch (repair.classification) {
      case "valid_au_mobile":
        summary.valid_au_mobiles += 1;
        break;
      case "repaired_au_mobile":
        summary.repaired_au_mobiles += 1;
        break;
      case "valid_au_landline":
        summary.valid_au_landlines += 1;
        break;
      case "invalid_phone":
        summary.invalid_phones += 1;
        break;
      case "incomplete_phone":
        summary.incomplete_phones += 1;
        break;
      case "ambiguous_phone":
        summary.ambiguous_phones += 1;
        break;
      case "empty_phone":
        summary.empty_phones += 1;
        break;
    }

    const actions = safeRepairActions(repair);
    if (actions.includes("removed_extra_trunk_zero")) summary.extra_trunk_zero_repairs += 1;
    if (actions.includes("added_country_code") && repair.applied) {
      summary.nine_digit_mobile_repairs += 1;
    }
  }
  return summary;
}
