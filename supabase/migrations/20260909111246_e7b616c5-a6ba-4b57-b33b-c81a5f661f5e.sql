CREATE TABLE public.credit_topups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by uuid,
  pack_id text NOT NULL,
  credits integer NOT NULL CHECK (credits > 0),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'aud',
  status text NOT NULL DEFAULT 'pending',
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  credited_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX credit_topups_business_created_idx ON public.credit_topups (business_id, created_at DESC);

GRANT SELECT ON public.credit_topups TO authenticated;
GRANT ALL ON public.credit_topups TO service_role;

ALTER TABLE public.credit_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_topups tenant read" ON public.credit_topups
  FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

CREATE TRIGGER credit_topups_updated
  BEFORE UPDATE ON public.credit_topups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tenant_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by uuid,
  kind text NOT NULL CHECK (kind IN ('cancellation', 'number_request', 'support')),
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'withdrawn')),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_requests_business_created_idx ON public.tenant_requests (business_id, created_at DESC);

GRANT SELECT, INSERT ON public.tenant_requests TO authenticated;
GRANT ALL ON public.tenant_requests TO service_role;

ALTER TABLE public.tenant_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_requests tenant read" ON public.tenant_requests
  FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

CREATE POLICY "tenant_requests tenant insert" ON public.tenant_requests
  FOR INSERT TO authenticated
  WITH CHECK (business_id = private.current_business_id());

CREATE TRIGGER tenant_requests_updated
  BEFORE UPDATE ON public.tenant_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();