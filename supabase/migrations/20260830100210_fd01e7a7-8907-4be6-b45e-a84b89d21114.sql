ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS deletion_request_id uuid;

CREATE INDEX IF NOT EXISTS leads_business_deleted_at_idx
  ON public.leads (business_id, deleted_at);

CREATE TABLE IF NOT EXISTS public.lead_deletion_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  request_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL DEFAULT 'soft_delete' CHECK (action IN ('soft_delete', 'restore')),
  reason text,
  requested_lead_ids uuid[] NOT NULL DEFAULT '{}',
  requested_count integer NOT NULL DEFAULT 0,
  deleted_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (business_id, request_id)
);

GRANT SELECT ON public.lead_deletion_requests TO authenticated;
GRANT ALL ON public.lead_deletion_requests TO service_role;

ALTER TABLE public.lead_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their business deletion requests"
  ON public.lead_deletion_requests
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.profiles WHERE id = auth.uid() AND active
    )
  );

CREATE TRIGGER lead_deletion_requests_updated
  BEFORE UPDATE ON public.lead_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();