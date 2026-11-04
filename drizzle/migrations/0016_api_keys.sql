CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_last4 text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['leads:write']::text[],
  created_by uuid,
  last_used_at timestamptz,
  request_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_business_idx ON public.api_keys (business_id, created_at DESC);
GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business members view their API keys" ON public.api_keys
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE TABLE public.api_key_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_code integer NOT NULL,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_key_requests_key_idx ON public.api_key_requests (api_key_id, created_at DESC);
CREATE INDEX api_key_requests_business_idx ON public.api_key_requests (business_id, created_at DESC);
GRANT SELECT ON public.api_key_requests TO authenticated;
GRANT ALL ON public.api_key_requests TO service_role;
ALTER TABLE public.api_key_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business members view their API activity" ON public.api_key_requests
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());