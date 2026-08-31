ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS quote_form_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS flexible_requests_enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_slug_lower_unique
  ON public.businesses (LOWER(slug)) WHERE slug IS NOT NULL;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS qualification_note text;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS request_type text,
  ADD COLUMN IF NOT EXISTS approved_service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_name_snapshot text,
  ADD COLUMN IF NOT EXISTS flexible_request_text text,
  ADD COLUMN IF NOT EXISTS requires_owner_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_request_type_check
  CHECK (request_type IS NULL OR request_type IN ('quote', 'service', 'recommendation'));

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_origin_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_lead_origin_check
  CHECK (lead_origin IS NULL OR lead_origin IN ('live', 'historical', 'reactivation', 'crm_import', 'inbound_form'));

DROP INDEX IF EXISTS public.leads_business_external_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS leads_business_external_id_unique
  ON public.leads (business_id, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_approved_service_idx
  ON public.leads (approved_service_id) WHERE approved_service_id IS NOT NULL;