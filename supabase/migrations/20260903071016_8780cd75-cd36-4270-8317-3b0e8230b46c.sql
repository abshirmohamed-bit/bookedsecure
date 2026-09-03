ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_context text NOT NULL DEFAULT 'contact_only_unqualified',
  ADD COLUMN IF NOT EXISTS context_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_service_id uuid REFERENCES public.services(id),
  ADD COLUMN IF NOT EXISTS verified_vehicle text,
  ADD COLUMN IF NOT EXISTS verified_suburb text,
  ADD COLUMN IF NOT EXISTS verified_concern text,
  ADD COLUMN IF NOT EXISTS quote_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS booking_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS customer_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_source text,
  ADD COLUMN IF NOT EXISTS current_sequence text,
  ADD COLUMN IF NOT EXISTS manual_entry_by uuid;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_lead_context_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_lead_context_check CHECK (lead_context IN (
    'quote_chat_lead','active_form_enquiry','abandoned_quote','verified_historical_enquiry',
    'previous_customer','manually_added_contact','contact_only_unqualified','active_conversation',
    'campaign_reply','booked_lead','cold_lead','owner_review'));

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_quote_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_quote_status_check CHECK (quote_status IN ('none','in_progress','abandoned','quoted','expired'));

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_booking_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_booking_status_check CHECK (booking_status IN ('none','offered','scheduled','completed','cancelled'));

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_customer_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_customer_status_check CHECK (customer_status IN ('unknown','prospect','previous_customer'));

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_consent_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_consent_status_check CHECK (consent_status IN ('unknown','granted','declined','opted_out','suppressed'));

-- Consent / suppression status derived from existing records only; nothing overwritten.
UPDATE public.leads l SET
  consent_status = CASE
    WHEN l.opted_out_at IS NOT NULL THEN 'opted_out'
    WHEN l.sms_suppressed_at IS NOT NULL THEN 'suppressed'
    WHEN l.consent_record IS NOT NULL THEN 'granted'
    ELSE 'unknown' END,
  consent_source = COALESCE(l.consent_source, l.source_channel);

-- Booking / customer status from real jobs.
UPDATE public.leads l SET
  booking_status = 'completed', customer_status = 'previous_customer'
WHERE EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = l.id AND j.business_id = l.business_id AND j.completion_status = 'completed');

UPDATE public.leads l SET
  booking_status = 'scheduled', customer_status = 'prospect'
WHERE l.booking_status = 'none'
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = l.id AND j.business_id = l.business_id AND j.completion_status = 'scheduled');

-- Verified context copied only from fields the customer actually supplied.
UPDATE public.leads l SET
  verified_service_id = l.approved_service_id,
  verified_vehicle = NULLIF(btrim(COALESCE(l.vehicle_type, '')), ''),
  verified_suburb = NULLIF(btrim(COALESCE(l.suburb, '')), ''),
  verified_concern = NULLIF(btrim(COALESCE(l.main_concerns, '')), ''),
  context_verified_at = CASE
    WHEN l.approved_service_id IS NOT NULL
      OR NULLIF(btrim(COALESCE(l.vehicle_type, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(l.suburb, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(l.main_concerns, '')), '') IS NOT NULL
    THEN COALESCE(l.updated_at, l.created_at) ELSE NULL END;

-- Deterministic classification, most specific first.
UPDATE public.leads l SET lead_context = CASE
  WHEN l.requires_owner_review THEN 'owner_review'
  WHEN l.booking_status = 'completed' THEN 'previous_customer'
  WHEN l.booking_status = 'scheduled' THEN 'booked_lead'
  WHEN EXISTS (SELECT 1 FROM public.web_conversations w WHERE w.lead_id = l.id AND w.business_id = l.business_id)
    THEN 'quote_chat_lead'
  WHEN l.lead_origin = 'crm_import' AND l.context_verified_at IS NULL THEN 'contact_only_unqualified'
  WHEN l.lead_origin = 'crm_import' THEN 'verified_historical_enquiry'
  WHEN l.context_verified_at IS NULL THEN 'contact_only_unqualified'
  ELSE 'active_form_enquiry' END;

UPDATE public.leads SET quote_status = 'in_progress'
WHERE lead_context IN ('quote_chat_lead','active_form_enquiry') AND quote_status = 'none';

CREATE INDEX IF NOT EXISTS leads_business_context_idx ON public.leads (business_id, lead_context);
CREATE INDEX IF NOT EXISTS leads_business_sequence_idx ON public.leads (business_id, current_sequence);