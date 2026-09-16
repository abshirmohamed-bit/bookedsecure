CREATE TABLE public.business_identity (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  legal_name text NOT NULL DEFAULT '',
  trading_name text,
  abn text NOT NULL DEFAULT '',
  address_line1 text NOT NULL DEFAULT '',
  address_line2 text,
  suburb text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  postcode text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'AU',
  website text,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  message_types text[] NOT NULL DEFAULT '{}',
  declaration_accepted_at timestamptz,
  declaration_accepted_by uuid,
  status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.business_identity TO authenticated;
GRANT ALL ON public.business_identity TO service_role;

ALTER TABLE public.business_identity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_identity tenant read"
ON public.business_identity FOR SELECT TO authenticated
USING (
  business_id = private.current_business_id()
  OR private.has_role(auth.uid(), 'platform_admin'::public.app_role)
);

CREATE POLICY "business_identity owner insert"
ON public.business_identity FOR INSERT TO authenticated
WITH CHECK (
  business_id = private.current_business_id()
  AND private.has_role(auth.uid(), 'owner'::public.app_role)
);

CREATE POLICY "business_identity owner update"
ON public.business_identity FOR UPDATE TO authenticated
USING (
  business_id = private.current_business_id()
  AND private.has_role(auth.uid(), 'owner'::public.app_role)
)
WITH CHECK (
  business_id = private.current_business_id()
  AND private.has_role(auth.uid(), 'owner'::public.app_role)
);

CREATE TRIGGER business_identity_updated
BEFORE UPDATE ON public.business_identity
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();