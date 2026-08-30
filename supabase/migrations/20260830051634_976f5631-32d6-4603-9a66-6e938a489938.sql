CREATE TABLE public.import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename text,
  format text NOT NULL CHECK (format IN ('crm','meta')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','previewed','committed','cancelled','failed')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  created_rows integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own business import batches"
  ON public.import_batches FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid()));

CREATE TABLE public.lead_import_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  row_number integer NOT NULL,
  raw_row jsonb,
  normalized_payload jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_match_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','skip','merge','create')),
  resulting_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_import_rows TO authenticated;
GRANT ALL ON public.lead_import_rows TO service_role;
ALTER TABLE public.lead_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own business import rows"
  ON public.lead_import_rows FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX import_batches_business_id_idx ON public.import_batches (business_id);
CREATE INDEX import_batches_status_idx ON public.import_batches (status);
CREATE INDEX lead_import_rows_batch_id_idx ON public.lead_import_rows (batch_id);
CREATE INDEX lead_import_rows_business_id_idx ON public.lead_import_rows (business_id);
CREATE INDEX lead_import_rows_decision_idx ON public.lead_import_rows (decision);
CREATE INDEX lead_import_rows_dedupe_match_lead_id_idx ON public.lead_import_rows (dedupe_match_lead_id);

CREATE TRIGGER import_batches_updated BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER lead_import_rows_updated BEFORE UPDATE ON public.lead_import_rows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();