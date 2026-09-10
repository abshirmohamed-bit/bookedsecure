# Import any contact list, no clean-up needed

## What I found in your current import (audit)

Verified against your code and your last upload (439 rows):

- The file reader, the Australian phone-number repair, the duplicate check against your existing customers and the safe save path all already exist and work. Your last upload was read correctly: 377 rows matched customers you already have, 7 were repeats inside the file, 6 had unusable numbers, 5 had neither number nor email, 3 had no name.
- **Nothing was ready to save (0 of 439).** A contact only qualifies today when it has a name, a valid mobile **and** an email, and is not a duplicate. Anything else is put in "held for review".
- **Held contacts are now a dead end.** The review screen was removed, so held rows can never be resolved. That is why every upload looks stuck.
- **Missing pieces for messy files:** no support for separate "First name" / "Last name" columns, no way to build a name from an email address, and source detection only recognises a handful of words (anything else becomes "unknown").

## What we build

One rule set, applied automatically in the background, no tools for the tenant to operate.

For every uploaded row we keep only: first/last name, mobile number, email, and source.

1. **Column matching gets smarter.** Recognise separate first/last name columns and join them, plus more spellings for phone, email and source (including exports from GoDaddy, Facebook/Meta lead ads, HubSpot, Excel exports and generic CRMs). Each value stays tied to its own row, so a number can never land on the wrong person.
2. **Name repair.** No name but an email like `jane.smith@…`? Use "Jane Smith". Only a single name? Keep it. Nothing usable at all? Fall back to the contact's own number as the label rather than dropping them.
3. **Number repair stays.** The existing Australian repair engine keeps running automatically, keeping your original values untouched, exactly as now.
4. **No usable mobile means skipped.** Reported as "skipped — no mobile number", not held. Email-only contacts are not saved.
5. **Email is optional.** Missing an email no longer holds a contact back.
6. **Repeats are handled quietly.** A contact already in your inbox is not added twice; any missing email, name or address on the existing record is filled in from the upload. Repeats inside the same file are collapsed to one contact.
7. **Source is always recorded** — CRM import, GoDaddy, Facebook/Instagram, website, referral, phone, manual — with the original wording preserved underneath.
8. **Nothing gets held any more.** Every row ends in one of four honest buckets: saved, updated an existing contact, already there, or skipped with a plain reason.

## What you see

Upload a file, then a short summary:

```text
439 contacts checked
   312 saved to your inbox
    59 numbers corrected automatically
    62 already in your inbox (details topped up)
     6 skipped — no usable mobile number
```

Plus a one-tap "Save to my inbox" button. No advanced view, no repair fields, no tables.

## Technical notes

- Extend `FIELD_ALIASES` / `canonicalField` in `src/lib/csv-import.ts` with first/last name and wider phone/email/source aliases; add a pure `deriveName()` (first+last join, email-local-part parse, single-name accept) applied in `prepareRow`.
- Widen `SOURCE_MAP` and keep `source_channel_raw`; source resolution also considers file name and platform columns.
- Change the eligibility contract so `missing_email` no longer prevents inclusion, and `missing_phone` becomes a terminal *skip* rather than manual review: adjust `classifyRow` in `src/lib/row-review.ts` and the reason sets in `src/lib/commit-gate.ts`.
- Replace held-for-review with outcome buckets in `src/lib/import-lite.ts` (`saved | updated | already_there | skipped`), drop the advanced-view highlight, and rewrite the summary copy.
- Duplicate handling: existing-lead matches become a gap-fill update path in `src/lib/import-lead.server.ts` (only writes columns that are currently empty; never overwrites tenant data, never changes status, never messages). In-file repeats keep the first row.
- Preview classification/repair already runs automatically from `LiteImportPanel`; keep that and remove the "held" branch of the UI.
- Import mode gating stays, but the panel explains it in plain language instead of "not switched on".
- All changes stay tenant-scoped; no writes outside the existing controlled import paths; no automatic messaging.
- Tests: extend `csv-import.test.ts`, `row-review`/`commit-gate` coverage, `import-lite.test.ts`, and add fixtures for a GoDaddy-style, a Meta-style and a deliberately messy export.
