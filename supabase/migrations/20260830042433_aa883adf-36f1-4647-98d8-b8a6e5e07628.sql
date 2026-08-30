ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source_metadata jsonb,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS lead_origin text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS email_normalised text;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_lead_origin_check
  CHECK (lead_origin IS NULL OR lead_origin IN ('live', 'historical', 'reactivation'));

CREATE INDEX IF NOT EXISTS leads_business_mobile_idx
  ON public.leads (business_id, mobile_number);

CREATE INDEX IF NOT EXISTS leads_business_email_normalised_idx
  ON public.leads (business_id, email_normalised)
  WHERE email_normalised IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_business_external_id_idx
  ON public.leads (business_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_import_batch_id_idx
  ON public.leads (import_batch_id)
  WHERE import_batch_id IS NOT NULL;