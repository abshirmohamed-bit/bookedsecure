# Roadmap: Facebook → Make lead import completion

- [ ] 1. Preserve whole enquiry: store all FB question/answer pairs (incl. unmapped), map into existing lead fields (service_intent, request_type, service snapshot, vehicle, address, notes, dates/urgency)
- [ ] 2. Request type vs booking status: no auto-confirmed bookings from form data
- [ ] 3. Conversion tracking: link enquiry → quote → booking on same lead
- [ ] 4. Safe reimport enrichment: fill missing fields, no dupes/overwrites/downgrades; distinguish "already received" vs "enriched"
- [ ] 5. Revised Make payload contract + verify deployed routes/settings panel
- [ ] 6. Tenant-scoped tools: import status, trigger import, run results, full enquiry read, sync status
- [ ] 7. Verification tests before enabling automatic imports
