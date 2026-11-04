# Roadmap: Facebook → Make lead import completion

- [x] 1. Preserve whole enquiry: raw answers stored, mapped into existing lead fields
- [x] 2. Request type vs booking status: imports create quote/service enquiries only, never bookings
- [~] 3. Conversion tracking: enquiry→booking link exists via lead; no external booking-provider connection exists yet (bookings come from owner action or assistant booking tools only)
- [x] 4. Safe reimport enrichment: fill-only patch, "enriched" outcome distinct from "duplicate"
- [x] 5. Make payload contract unchanged (field_data passthrough); needs publish before live test
- [x] 6. Assistant tools: import status, runs, run items, full enquiry, owner-gated import trigger
- [~] 7. Unit tests pass (1,991); live import tests pending publish + Make run
