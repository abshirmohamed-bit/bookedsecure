import { describe, expect, it } from 'vitest';
import { assistantImportCounts } from './assistant-import-summary';

describe('Co-Work mobile import counts', () => {
  it('reports 10 existing and 5 without mobiles as zero new, not 5 ready and 10 invalid', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ normalized_payload: { mobile_number: '+61412345678' },
        validation_errors: [{ code: 'duplicate_existing_phone' }], dedupe_match_lead_id: 'existing', duplicate_of_row: null })),
      ...Array.from({ length: 5 }, () => ({ normalized_payload: { mobile_number: null },
        validation_errors: [], dedupe_match_lead_id: null, duplicate_of_row: null })),
    ];
    const counts = assistantImportCounts(rows);
    expect(counts).toEqual({ totalRows: 15, validRows: 0, duplicateRows: 10, invalidRows: 5 });
    expect(counts.validRows + counts.duplicateRows + counts.invalidRows).toBe(15);
  });
  it('excludes repeats within the file even when their mobile is valid', () => {
    expect(assistantImportCounts([{ normalized_payload: { mobile_number: '+61412345678' },
      validation_errors: [], dedupe_match_lead_id: null, duplicate_of_row: 1 }])).toMatchObject({ validRows: 0, invalidRows: 1 });
  });
});