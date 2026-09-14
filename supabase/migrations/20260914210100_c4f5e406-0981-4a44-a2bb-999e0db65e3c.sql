ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS abn text,
  ADD COLUMN IF NOT EXISTS website_url text;

CREATE TABLE public.promo_codes (
  code text PRIMARY KEY,
  description text,
  plan_id text REFERENCES public.plans(id),
  credit_price_cents integer,
  credit_pack_set text NOT NULL DEFAULT 'standard',
  max_redemptions integer,
  reserved_business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins can read promo codes"
  ON public.promo_codes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'platform_admin'::public.app_role));

CREATE TRIGGER promo_codes_updated
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.business_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL REFERENCES public.promo_codes(code) ON DELETE CASCADE,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX business_promo_codes_code_idx ON public.business_promo_codes(code);

GRANT SELECT ON public.business_promo_codes TO authenticated;
GRANT ALL ON public.business_promo_codes TO service_role;
ALTER TABLE public.business_promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read their own business promo code"
  ON public.business_promo_codes FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    OR private.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );

CREATE TRIGGER business_promo_codes_updated
  BEFORE UPDATE ON public.business_promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();