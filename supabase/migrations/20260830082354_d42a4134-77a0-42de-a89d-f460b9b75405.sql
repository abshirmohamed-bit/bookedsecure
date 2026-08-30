ALTER TABLE public.leads DROP CONSTRAINT leads_lead_origin_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_origin_check CHECK (
  lead_origin IS NULL OR lead_origin = ANY (ARRAY['live'::text, 'historical'::text, 'reactivation'::text, 'crm_import'::text])
);