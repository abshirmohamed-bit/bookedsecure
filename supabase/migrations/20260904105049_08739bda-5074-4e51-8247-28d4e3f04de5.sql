-- Promote consent onto the exact leads that already own affirmative consent
-- evidence (a consent_given event AND consent_record.consented = true) but were
-- left at consent_status = 'unknown' by the owner-review branch of the quote
-- flow. Evidence-based and lead-scoped: consent is never inferred from a phone
-- number, email, CRM provenance, prior enquiry or lead stage, and never copied
-- between leads. Idempotent: re-running changes nothing.
UPDATE public.leads AS l
SET consent_status = 'granted',
    consent_source = COALESCE(NULLIF(l.consent_record->>'source_channel', ''), 'website')
WHERE l.consent_status = 'unknown'
  AND l.opted_out_at IS NULL
  AND l.sms_suppressed_at IS NULL
  AND (l.consent_record->>'consented') = 'true'
  AND EXISTS (
    SELECT 1
    FROM public.consent_events ce
    WHERE ce.lead_id = l.id
      AND ce.business_id = l.business_id
      AND ce.event_type = 'consent_given'
      AND ce.channel = 'sms'
  );