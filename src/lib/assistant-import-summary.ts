type ImportRow = {
  normalized_payload: { mobile_number?: string | null };
  validation_errors: { code: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
};

/** Mutually exclusive categories for the mobile-only Cowork import action. */
export function assistantImportCounts(rows: readonly ImportRow[]) {
  const counts = { totalRows: rows.length, validRows: 0, duplicateRows: 0, invalidRows: 0 };
  for (const row of rows) {
    const blocked = !/^\+614\d{8}$/.test(row.normalized_payload.mobile_number ?? '') ||
      row.duplicate_of_row !== null ||
      row.validation_errors.some(error => !error.code.startsWith('duplicate_existing_'));
    if (blocked) counts.invalidRows++;
    else if (row.dedupe_match_lead_id !== null) counts.duplicateRows++;
    else counts.validRows++;
  }
  return counts;
}